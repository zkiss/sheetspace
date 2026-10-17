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

data class CalculatedCellAppend(val columnId: String, val raw: String)

data class ColumnAppendResult(
    val sheet: SheetDocument,
    val columnId: ColumnId,
)

data class CellPatchCommand(
    val expectedRevisions: List<ExpectedSheetRevision>,
    val cells: List<SheetCellWrite>,
)

data class DataModelStateCommand(
    val expectedRevisions: List<ExpectedSheetRevision>,
    val workbook: WorkbookBundleResponse,
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
    READ_ONLY_CALCULATED_CELL,
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

    fun writePresentation(sheetId: String, expectedRevision: Long, writes: List<AxisSizeWrite>, formatWrites: List<FormatWrite> = emptyList()): SheetDocument

    fun updateSheetZOrder(updates: List<SheetZOrderUpdate>): List<SheetDocument>

    fun deleteSheet(sheetId: String, expectedRevision: Long)

    fun writeCells(command: CellPatchCommand): List<SheetDocument>

    fun appendRow(sheetId: String, expectedRevision: Long, calculatedCells: List<CalculatedCellAppend> = emptyList()): RowAppendResult

    fun appendColumn(sheetId: String, expectedRevision: Long): ColumnAppendResult

    fun replaceDataModelState(command: DataModelStateCommand): List<SheetDocument>
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

    override fun writePresentation(sheetId: String, expectedRevision: Long, writes: List<AxisSizeWrite>, formatWrites: List<FormatWrite>): SheetDocument {
        loadSheet(sheetId)
        return store.writePresentation(ExpectedSheetRevision(sheetId, expectedRevision), writes, formatWrites)
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

    override fun appendRow(sheetId: String, expectedRevision: Long, calculatedCells: List<CalculatedCellAppend>): RowAppendResult {
        val sheet = updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            val model = current.dataModelId?.let(workbook.dataModels::get)
            if (current.dataModelId != null && model == null) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            val expectedCalculatedColumns = model?.properties?.mapIndexedNotNull { index, property ->
                if (property is CalculatedDataModelProperty) current.tabularContent.columns.getOrNull(index)?.value else null
            } ?: emptyList()
            if (calculatedCells.map(CalculatedCellAppend::columnId).distinct().size != calculatedCells.size || calculatedCells.map(CalculatedCellAppend::columnId).toSet() != expectedCalculatedColumns.toSet() || calculatedCells.any { !it.raw.startsWith("=") }) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            val withRow = current.tabularContent.appendRow()
            val rowId = withRow.rows.last()
            val contents = withRow.cellContents + calculatedCells.associate { CellCoordinate(rowId, ColumnId(it.columnId)) to it.raw }
            workbook.replaceSheet(current.copy(content = TabularContent(withRow.rows, withRow.columns, contents)))
        }
        return RowAppendResult(sheet, sheet.tabularContent.rows.last())
    }

    override fun appendColumn(sheetId: String, expectedRevision: Long): ColumnAppendResult {
        val sheet = updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            workbook.replaceSheet(current.updateTabularContent(TabularContent::appendColumn))
        }
        return ColumnAppendResult(sheet, sheet.tabularContent.columns.last())
    }

    override fun replaceDataModelState(command: DataModelStateCommand): List<SheetDocument> {
        if (command.expectedRevisions.isEmpty() || command.expectedRevisions.map { it.sheetId }.distinct().size != command.expectedRevisions.size) {
            throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        }
        val updated = dataModelState(command.workbook)
        return store.updateWorkbook { current ->
            command.expectedRevisions.forEach { expected ->
                val sheet = current.findSheet(SheetId(expected.sheetId))
                    ?: throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND)
                if (sheet.revision != expected.revision) throw SheetRevisionConflict(expected.sheetId, expected.revision, sheet.revision)
            }
            // A data model transition is a complete aggregate replacement supplied by the frontend
            // domain layer.  It is committed in this one store transaction after all revisions pass.
            require(updated.manifest.sheetIds == current.manifest.sheetIds) { "Data model transition cannot change sheets" }
            updated
        }.sheetsInOrder
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

private fun dataModelState(bundle: WorkbookBundleResponse): WorkbookState {
    if (bundle.manifest.version != WORKBOOK_SCHEMA_VERSION || bundle.manifest.sheetIds.distinct().size != bundle.manifest.sheetIds.size) {
        throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
    }
    val models = bundle.dataModels.associate { response ->
        if (response.id.toUuidBytesOrNull() == null || response.name.isBlank() || response.properties.map { it.name }.distinct().size != response.properties.size) {
            throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        }
        response.id to DataModel(response.id, response.name, response.properties.map { property ->
            if (property.id.toUuidBytesOrNull() == null || property.name.isBlank()) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            when (property.kind) {
                "manual" -> if (property.formula == null) ManualDataModelProperty(property.id, property.name) else throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
                "calculated" -> property.formula?.takeIf { it.startsWith("=") }
                    ?.let { CalculatedDataModelProperty(property.id, property.name, it) }
                    ?: throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
                else -> throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
        })
    }
    val documents = bundle.documents.associate { response ->
        if (response.id.toUuidBytesOrNull() == null || response.content.kind != "tabular" || response.content.rows.any { it.toUuidBytesOrNull() == null } || response.content.columns.any { it.toUuidBytesOrNull() == null } || response.content.rows.distinct().size != response.content.rows.size || response.content.columns.distinct().size != response.content.columns.size) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        val rows = response.content.rows.map(::RowId); val columns = response.content.columns.map(::ColumnId)
        if (response.dataModelId?.let(models::get) == null && response.dataModelId != null) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        val cells = response.content.cells.associate { cell ->
            val coordinate = CellCoordinate(RowId(cell.rowId), ColumnId(cell.columnId))
            if (coordinate.rowId !in rows || coordinate.columnId !in columns) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            coordinate to cell.content
        }
        if (cells.size != response.content.cells.size) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        val model = response.dataModelId?.let(models::get)
        if (model != null && (columns.size != model.properties.size || cells.any { (coordinate, raw) -> model.properties[columns.indexOf(coordinate.columnId)] is CalculatedDataModelProperty && !raw.startsWith("=") })) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        SheetId(response.id) to SheetDocument(SheetId(response.id), response.revision, response.name, FrameState(response.frame.position, response.frame.size, response.frame.visualScale, response.frame.zIndex), SheetPresentation(response.presentation.rowHeights, response.presentation.columnWidths, response.presentation.formatOverrides), TabularContent(rows, columns, cells), response.dataModelId)
    }
    if (documents.keys.map { it.value } != bundle.manifest.sheetIds) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
    return WorkbookState(WorkbookManifest(bundle.manifest.version, bundle.manifest.revision, bundle.manifest.sheetIds.map(::SheetId)), documents, models)
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
