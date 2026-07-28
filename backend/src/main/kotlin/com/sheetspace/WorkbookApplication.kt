package com.sheetspace

data class CreateSheetCommand(
    val name: String,
    val position: WorkspacePosition = WorkspacePosition(),
    val frameSize: SheetFrameSize = SheetFrameSize(),
    val zIndex: Int? = null,
)

data class UpdateSheetCommand(
    val name: String? = null,
    val position: WorkspacePosition? = null,
    val frameSize: SheetFrameSize? = null,
    val zIndex: Int? = null,
)

enum class WorkbookApplicationError {
    SHEET_NOT_FOUND,
    SHEET_NAME_REQUIRED,
    SHEET_NAME_DUPLICATE,
    SHEET_UPDATE_REQUIRED,
    INVALID_SHEET_POSITION,
    INVALID_SHEET_FRAME_SIZE,
    INVALID_SHEET_Z_INDEX,
    INVALID_CELL_ADDRESS,
}

class WorkbookApplicationException(
    val error: WorkbookApplicationError,
) : RuntimeException("Workbook operation rejected: $error")

interface WorkbookApplication {
    fun loadWorkbook(): Workbook

    fun loadSheet(sheetId: String): Sheet

    fun createSheet(command: CreateSheetCommand): Sheet

    fun updateSheet(sheetId: String, expectedRevision: Long, command: UpdateSheetCommand): Sheet

    fun deleteSheet(sheetId: String, expectedRevision: Long)

    fun updateCell(sheetId: String, address: String, content: String, expectedRevision: Long): Sheet

    fun appendRow(sheetId: String, expectedRevision: Long): Sheet

    fun appendColumn(sheetId: String, expectedRevision: Long): Sheet
}

class DefaultWorkbookApplication(
    private val store: WorkbookStore,
) : WorkbookApplication {
    override fun loadWorkbook(): Workbook = store.loadWorkbook()

    override fun loadSheet(sheetId: String): Sheet =
        store.loadWorkbook().sheets.find { it.id == sheetId }
            ?: reject(WorkbookApplicationError.SHEET_NOT_FOUND)

    override fun createSheet(command: CreateSheetCommand): Sheet {
        if (!command.position.isValidWorkspacePosition()) {
            reject(WorkbookApplicationError.INVALID_SHEET_POSITION)
        }
        if (!command.frameSize.isValidSheetFrameSize()) {
            reject(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE)
        }
        if (!command.zIndex.isValidSheetZIndex()) {
            reject(WorkbookApplicationError.INVALID_SHEET_Z_INDEX)
        }

        lateinit var createdSheet: Sheet
        val updated = store.updateWorkbook { workbook ->
            createdSheet = when (
                val result = com.sheetspace.createSheet(
                    name = command.name,
                    existingSheets = workbook.sheets,
                    position = command.position,
                    frameSize = command.frameSize,
                    zIndex = command.zIndex,
                )
            ) {
                is SheetNameResult.Valid -> result.value
                is SheetNameResult.Invalid -> reject(result.reason.applicationError)
            }
            workbook.copy(sheets = workbook.sheets + createdSheet)
        }
        return updated.sheets.single { it.id == createdSheet.id }
    }

    override fun updateSheet(
        sheetId: String,
        expectedRevision: Long,
        command: UpdateSheetCommand,
    ): Sheet {
        loadSheet(sheetId)
        if (
            command.name == null &&
            command.position == null &&
            command.frameSize == null &&
            command.zIndex == null
        ) {
            reject(WorkbookApplicationError.SHEET_UPDATE_REQUIRED)
        }
        if (command.position?.isValidWorkspacePosition() == false) {
            reject(WorkbookApplicationError.INVALID_SHEET_POSITION)
        }
        if (command.frameSize?.isValidSheetFrameSize() == false) {
            reject(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE)
        }
        if (!command.zIndex.isValidSheetZIndex()) {
            reject(WorkbookApplicationError.INVALID_SHEET_Z_INDEX)
        }

        return updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            val renamed = if (command.name == null) {
                workbook
            } else {
                when (val result = com.sheetspace.renameSheet(workbook, sheetId, command.name)) {
                    is WorkbookResult.Valid -> result.workbook
                    is WorkbookResult.InvalidName -> reject(result.reason.applicationError)
                    WorkbookResult.UnknownSheet -> reject(WorkbookApplicationError.SHEET_NOT_FOUND)
                }
            }
            renamed.copy(
                sheets = renamed.sheets.map { sheet ->
                    if (sheet.id != sheetId) {
                        sheet
                    } else {
                        sheet.copy(
                            position = command.position ?: current.position,
                            frameSize = command.frameSize ?: current.frameSize,
                            zIndex = command.zIndex ?: current.zIndex,
                        )
                    }
                },
            )
        }
    }

    override fun deleteSheet(sheetId: String, expectedRevision: Long) {
        store.updateWorkbook(ExpectedSheetRevision(sheetId, expectedRevision)) { workbook ->
            if (workbook.sheets.none { it.id == sheetId }) {
                reject(WorkbookApplicationError.SHEET_NOT_FOUND)
            }
            workbook.copy(sheets = workbook.sheets.filterNot { it.id == sheetId })
        }
    }

    override fun updateCell(
        sheetId: String,
        address: String,
        content: String,
        expectedRevision: Long,
    ): Sheet = updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
        if (!current.containsCell(address)) {
            reject(WorkbookApplicationError.INVALID_CELL_ADDRESS)
        }
        val nextCells = if (content.isEmpty()) {
            current.cells - address
        } else {
            current.cells + (address to content)
        }
        workbook.replaceSheet(current.copy(cells = nextCells))
    }

    override fun appendRow(sheetId: String, expectedRevision: Long): Sheet =
        updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            workbook.replaceSheet(com.sheetspace.appendRow(current))
        }

    override fun appendColumn(sheetId: String, expectedRevision: Long): Sheet =
        updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            workbook.replaceSheet(com.sheetspace.appendColumn(current))
        }

    private fun updateExistingSheet(
        sheetId: String,
        expectedRevision: Long,
        transform: (Workbook, Sheet) -> Workbook,
    ): Sheet {
        val updated = store.updateWorkbook(ExpectedSheetRevision(sheetId, expectedRevision)) { workbook ->
            val current = workbook.sheets.find { it.id == sheetId }
                ?: reject(WorkbookApplicationError.SHEET_NOT_FOUND)
            transform(workbook, current)
        }
        return updated.sheets.single { it.id == sheetId }
    }
}

private fun Workbook.replaceSheet(updated: Sheet): Workbook =
    copy(sheets = sheets.map { if (it.id == updated.id) updated else it })

private val SheetNameError.applicationError: WorkbookApplicationError
    get() = when (this) {
        SheetNameError.EMPTY -> WorkbookApplicationError.SHEET_NAME_REQUIRED
        SheetNameError.DUPLICATE -> WorkbookApplicationError.SHEET_NAME_DUPLICATE
    }

private fun reject(error: WorkbookApplicationError): Nothing {
    throw WorkbookApplicationException(error)
}
