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
    fun loadWorkbook(): WorkbookState

    fun loadSheet(sheetId: String): SheetDocument

    fun createSheet(command: CreateSheetCommand): SheetDocument

    fun updateSheet(sheetId: String, expectedRevision: Long, command: UpdateSheetCommand): SheetDocument

    fun deleteSheet(sheetId: String, expectedRevision: Long)

    fun updateCell(sheetId: String, address: String, content: String, expectedRevision: Long): SheetDocument

    fun appendRow(sheetId: String, expectedRevision: Long): SheetDocument

    fun appendColumn(sheetId: String, expectedRevision: Long): SheetDocument
}

class DefaultWorkbookApplication(
    private val store: WorkbookStore,
) : WorkbookApplication {
    override fun loadWorkbook(): WorkbookState = store.loadWorkbook()

    override fun loadSheet(sheetId: String): SheetDocument =
        store.loadSheet(SheetId(sheetId))
            ?: reject(WorkbookApplicationError.SHEET_NOT_FOUND)

    override fun createSheet(command: CreateSheetCommand): SheetDocument {
        validateFrameCommand(command.position, command.frameSize, command.zIndex)

        lateinit var createdSheet: SheetDocument
        val updated = store.updateWorkbook { workbook ->
            createdSheet = when (
                val result = createSheetDocument(
                    name = command.name,
                    existingSheets = workbook.documents.values,
                    position = command.position,
                    frameSize = command.frameSize,
                    zIndex = command.zIndex,
                )
            ) {
                is SheetNameResult.Valid -> result.value
                is SheetNameResult.Invalid -> reject(result.reason.applicationError)
            }
            workbook.addSheet(createdSheet)
        }
        return updated.documents.getValue(createdSheet.id)
    }

    override fun updateSheet(
        sheetId: String,
        expectedRevision: Long,
        command: UpdateSheetCommand,
    ): SheetDocument {
        loadSheet(sheetId)
        if (
            command.name == null &&
            command.position == null &&
            command.frameSize == null &&
            command.zIndex == null
        ) {
            reject(WorkbookApplicationError.SHEET_UPDATE_REQUIRED)
        }
        validateOptionalFrameCommand(command.position, command.frameSize, command.zIndex)

        return updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            val renamed = if (command.name == null) {
                current
            } else {
                when (
                    val result = validateSheetName(
                        command.name,
                        workbook.documents.values,
                        current.id,
                    )
                ) {
                    is SheetNameResult.Valid -> current.rename(result.value)
                    is SheetNameResult.Invalid -> reject(result.reason.applicationError)
                }
            }
            workbook.replaceSheet(
                renamed.updateFrame { frame ->
                    frame.update(
                        position = command.position,
                        size = command.frameSize,
                        zIndex = command.zIndex,
                    )
                },
            )
        }
    }

    override fun deleteSheet(sheetId: String, expectedRevision: Long) {
        val id = SheetId(sheetId)
        store.updateWorkbook(ExpectedSheetRevision(sheetId, expectedRevision)) { workbook ->
            if (workbook.findSheet(id) == null) {
                reject(WorkbookApplicationError.SHEET_NOT_FOUND)
            }
            workbook.removeSheet(id)
        }
    }

    override fun updateCell(
        sheetId: String,
        address: String,
        content: String,
        expectedRevision: Long,
    ): SheetDocument {
        val current = loadSheet(sheetId)
        val coordinate = current.tabularContent.coordinateAt(address)
            ?: reject(WorkbookApplicationError.INVALID_CELL_ADDRESS)
        return store.writeCells(
            ExpectedSheetRevision(sheetId, expectedRevision),
            listOf(CellWrite(coordinate, content)),
        )
    }

    override fun appendRow(sheetId: String, expectedRevision: Long): SheetDocument =
        updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            workbook.replaceSheet(current.updateTabularContent(TabularContent::appendRow))
        }

    override fun appendColumn(sheetId: String, expectedRevision: Long): SheetDocument =
        updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            workbook.replaceSheet(current.updateTabularContent(TabularContent::appendColumn))
        }

    private fun updateExistingSheet(
        sheetId: String,
        expectedRevision: Long,
        transform: (WorkbookState, SheetDocument) -> WorkbookState,
    ): SheetDocument {
        val id = SheetId(sheetId)
        val updated = store.updateWorkbook(ExpectedSheetRevision(sheetId, expectedRevision)) { workbook ->
            val current = workbook.findSheet(id)
                ?: reject(WorkbookApplicationError.SHEET_NOT_FOUND)
            transform(workbook, current)
        }
        return updated.documents.getValue(id)
    }
}

private fun validateFrameCommand(
    position: WorkspacePosition,
    frameSize: SheetFrameSize,
    zIndex: Int?,
) {
    if (!position.isValid()) reject(WorkbookApplicationError.INVALID_SHEET_POSITION)
    if (!frameSize.isValid()) reject(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE)
    if (zIndex != null && zIndex < 1) reject(WorkbookApplicationError.INVALID_SHEET_Z_INDEX)
}

private fun validateOptionalFrameCommand(
    position: WorkspacePosition?,
    frameSize: SheetFrameSize?,
    zIndex: Int?,
) {
    if (position?.isValid() == false) reject(WorkbookApplicationError.INVALID_SHEET_POSITION)
    if (frameSize?.isValid() == false) reject(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE)
    if (zIndex != null && zIndex < 1) reject(WorkbookApplicationError.INVALID_SHEET_Z_INDEX)
}

private val SheetNameError.applicationError: WorkbookApplicationError
    get() = when (this) {
        SheetNameError.EMPTY -> WorkbookApplicationError.SHEET_NAME_REQUIRED
        SheetNameError.DUPLICATE -> WorkbookApplicationError.SHEET_NAME_DUPLICATE
    }

private fun reject(error: WorkbookApplicationError): Nothing {
    throw WorkbookApplicationException(error)
}
