package com.sheetspace

data class CreateSheetCommand(
    val name: String,
    val position: WorkspacePosition = WorkspacePosition(),
    val frameSize: SheetFrameSize = SheetFrameSize(),
    val visualScale: Double = DEFAULT_SHEET_VISUAL_SCALE,
    val zIndex: Int? = null,
)

data class UpdateSheetCommand(
    val name: String? = null,
    val position: WorkspacePosition? = null,
    val frameSize: SheetFrameSize? = null,
    val visualScale: Double? = null,
)

data class SheetZOrderUpdate(
    val sheetId: String,
    val expectedRevision: Long,
    val zIndex: Int,
)

data class RowAppendResult(
    val sheet: SheetDocument,
    val rowId: RowId,
)

data class ColumnAppendResult(
    val sheet: SheetDocument,
    val columnId: ColumnId,
)

data class CellPatchCommand(
    val expectedRevisions: List<ExpectedSheetRevision>,
    val cells: List<SheetCellWrite>,
)

enum class WorkbookApplicationError {
    SHEET_NOT_FOUND,
    SHEET_NAME_REQUIRED,
    SHEET_NAME_DUPLICATE,
    SHEET_UPDATE_REQUIRED,
    INVALID_SHEET_POSITION,
    INVALID_SHEET_FRAME_SIZE,
    INVALID_SHEET_VISUAL_SCALE,
    INVALID_SHEET_Z_INDEX,
    SHEET_Z_ORDER_UPDATE_REQUIRED,
    DUPLICATE_SHEET_Z_ORDER_UPDATE,
    EMPTY_CELL_PATCH,
    DUPLICATE_CELL_WRITE,
    DUPLICATE_SHEET_REVISION,
    INVALID_CELL_COORDINATE,
    INVALID_CELL_PATCH,
    INVALID_SHEET_PRESENTATION,
}

class WorkbookApplicationException(
    val error: WorkbookApplicationError,
) : RuntimeException("Workbook operation rejected: $error")

interface WorkbookApplication {
    fun loadManifest(): WorkbookManifest

    fun loadWorkbookBundle(): WorkbookState

    fun loadSheet(sheetId: String): SheetDocument

    fun createSheet(command: CreateSheetCommand): SheetDocument

    fun updateSheet(sheetId: String, expectedRevision: Long, command: UpdateSheetCommand): SheetDocument

    fun writePresentation(sheetId: String, expectedRevision: Long, writes: List<AxisSizeWrite>): SheetDocument

    fun updateSheetZOrder(updates: List<SheetZOrderUpdate>): List<SheetDocument>

    fun deleteSheet(sheetId: String, expectedRevision: Long)

    fun writeCells(command: CellPatchCommand): List<SheetDocument>

    fun appendRow(sheetId: String, expectedRevision: Long): RowAppendResult

    fun appendColumn(sheetId: String, expectedRevision: Long): ColumnAppendResult
}

class DefaultWorkbookApplication(
    private val store: WorkbookStore,
) : WorkbookApplication {
    override fun loadManifest(): WorkbookManifest = store.loadManifest()

    override fun loadWorkbookBundle(): WorkbookState = store.loadWorkbookBundle()

    override fun loadSheet(sheetId: String): SheetDocument =
        store.loadSheet(SheetId(sheetId))
            ?: throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND)

    override fun createSheet(command: CreateSheetCommand): SheetDocument {
        validateFrameCommand(command.position, command.frameSize, command.visualScale, command.zIndex)

        lateinit var createdSheet: SheetDocument
        val updated = store.updateWorkbook { workbook ->
            createdSheet = when (
                val result = createSheetDocument(
                    name = command.name,
                    existingSheets = workbook.documents.values,
                    position = command.position,
                    frameSize = command.frameSize,
                    visualScale = command.visualScale,
                    zIndex = command.zIndex,
                )
            ) {
                is SheetNameResult.Valid -> result.value
                is SheetNameResult.Invalid -> throw WorkbookApplicationException(result.reason.applicationError)
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
            command.visualScale == null
        ) {
            throw WorkbookApplicationException(WorkbookApplicationError.SHEET_UPDATE_REQUIRED)
        }
        validateOptionalFrameCommand(command.position, command.frameSize, command.visualScale)

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
                    is SheetNameResult.Invalid -> throw WorkbookApplicationException(result.reason.applicationError)
                }
            }
            workbook.replaceSheet(
                renamed.updateFrame { frame ->
                    frame.update(
                        position = command.position,
                        size = command.frameSize,
                        visualScale = command.visualScale,
                    )
                },
            )
        }
    }

    override fun writePresentation(sheetId: String, expectedRevision: Long, writes: List<AxisSizeWrite>): SheetDocument {
        loadSheet(sheetId)
        return store.writePresentation(ExpectedSheetRevision(sheetId, expectedRevision), writes)
    }

    override fun updateSheetZOrder(updates: List<SheetZOrderUpdate>): List<SheetDocument> {
        if (updates.isEmpty()) throw WorkbookApplicationException(WorkbookApplicationError.SHEET_Z_ORDER_UPDATE_REQUIRED)
        if (updates.map(SheetZOrderUpdate::sheetId).distinct().size != updates.size) {
            throw WorkbookApplicationException(WorkbookApplicationError.DUPLICATE_SHEET_Z_ORDER_UPDATE)
        }
        updates.forEach { update ->
            loadSheet(update.sheetId)
            if (update.zIndex < 1) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_Z_INDEX)
        }
        return store.updateSheetZOrder(
            updates.map { update ->
                SheetZOrderWrite(
                    expectedRevision = ExpectedSheetRevision(update.sheetId, update.expectedRevision),
                    zIndex = update.zIndex,
                )
            },
        )
    }

    override fun deleteSheet(sheetId: String, expectedRevision: Long) {
        val id = SheetId(sheetId)
        store.updateWorkbook(ExpectedSheetRevision(sheetId, expectedRevision)) { workbook ->
            if (workbook.findSheet(id) == null) {
                throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND)
            }
            workbook.removeSheet(id)
        }
    }

    override fun writeCells(command: CellPatchCommand): List<SheetDocument> {
        if (command.cells.isEmpty()) throw WorkbookApplicationException(WorkbookApplicationError.EMPTY_CELL_PATCH)
        if (command.cells.any { write ->
                write.sheetId.toUuidBytesOrNull() == null ||
                    write.rowId.toUuidBytesOrNull() == null ||
                    write.columnId.toUuidBytesOrNull() == null
            }
        ) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        if (command.expectedRevisions.any { it.sheetId.toUuidBytesOrNull() == null || it.revision < 0 }) {
            throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        }
        if (command.cells.map { Triple(it.sheetId, it.rowId, it.columnId) }.distinct().size != command.cells.size) {
            throw WorkbookApplicationException(WorkbookApplicationError.DUPLICATE_CELL_WRITE)
        }
        if (command.expectedRevisions.map(ExpectedSheetRevision::sheetId).distinct().size != command.expectedRevisions.size) {
            throw WorkbookApplicationException(WorkbookApplicationError.DUPLICATE_SHEET_REVISION)
        }
        val touchedSheetIds = command.cells.map(SheetCellWrite::sheetId).distinct()
        if (command.expectedRevisions.map(ExpectedSheetRevision::sheetId).toSet() != touchedSheetIds.toSet()) {
            throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        }
        command.cells.forEach { write ->
            val sheet = loadSheet(write.sheetId)
            if (RowId(write.rowId) !in sheet.tabularContent.rows || ColumnId(write.columnId) !in sheet.tabularContent.columns) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_COORDINATE)
            }
        }
        command.expectedRevisions.forEach { expected -> loadSheet(expected.sheetId) }
        return store.writeCells(command.expectedRevisions, command.cells)
    }

    override fun appendRow(sheetId: String, expectedRevision: Long): RowAppendResult {
        val sheet = updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            workbook.replaceSheet(current.updateTabularContent(TabularContent::appendRow))
        }
        return RowAppendResult(sheet, sheet.tabularContent.rows.last())
    }

    override fun appendColumn(sheetId: String, expectedRevision: Long): ColumnAppendResult {
        val sheet = updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            workbook.replaceSheet(current.updateTabularContent(TabularContent::appendColumn))
        }
        return ColumnAppendResult(sheet, sheet.tabularContent.columns.last())
    }

    private fun updateExistingSheet(
        sheetId: String,
        expectedRevision: Long,
        transform: (WorkbookState, SheetDocument) -> WorkbookState,
    ): SheetDocument {
        val id = SheetId(sheetId)
        val updated = store.updateWorkbook(ExpectedSheetRevision(sheetId, expectedRevision)) { workbook ->
            val current = workbook.findSheet(id)
                ?: throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND)
            transform(workbook, current)
        }
        return updated.documents.getValue(id)
    }
}

private fun validateFrameCommand(
    position: WorkspacePosition,
    frameSize: SheetFrameSize,
    visualScale: Double,
    zIndex: Int?,
) {
    if (!position.isValid()) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_POSITION)
    if (!frameSize.isValid()) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE)
    if (!isValidSheetVisualScale(visualScale)) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE)
    if (zIndex != null && zIndex < 1) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_Z_INDEX)
}

private fun validateOptionalFrameCommand(
    position: WorkspacePosition?,
    frameSize: SheetFrameSize?,
    visualScale: Double?,
) {
    if (position?.isValid() == false) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_POSITION)
    if (frameSize?.isValid() == false) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE)
    if (visualScale != null && !isValidSheetVisualScale(visualScale)) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE)
}

private val SheetNameError.applicationError: WorkbookApplicationError
    get() = when (this) {
        SheetNameError.EMPTY -> WorkbookApplicationError.SHEET_NAME_REQUIRED
        SheetNameError.DUPLICATE -> WorkbookApplicationError.SHEET_NAME_DUPLICATE
    }
