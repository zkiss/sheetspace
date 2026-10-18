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

    fun appendRow(sheetId: String, expectedRevision: Long, calculatedCells: List<CalculatedCellAppend> = emptyList(), rowId: String? = null): RowAppendResult

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

    override fun appendRow(sheetId: String, expectedRevision: Long, calculatedCells: List<CalculatedCellAppend>, rowId: String?): RowAppendResult {
        val sheet = updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            if (rowId?.toUuidBytesOrNull() == null && rowId != null) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            val appendedRowId = rowId?.let(::RowId) ?: RowId.generate()
            if (appendedRowId in current.tabularContent.rows) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            val model = current.dataModelId?.let(workbook.dataModels::get)
            if (current.dataModelId != null && model == null) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            val expectedCalculatedColumns = model?.properties?.mapIndexedNotNull { index, property ->
                if (property is CalculatedDataModelProperty) current.tabularContent.columns.getOrNull(index)?.value else null
            } ?: emptyList()
            if (
                calculatedCells.map(CalculatedCellAppend::columnId).distinct().size != calculatedCells.size ||
                calculatedCells.map(CalculatedCellAppend::columnId).toSet() != expectedCalculatedColumns.toSet() ||
                !hasModelOwnedCalculatedAppends(
                    calculatedCells,
                    workbook.replaceSheet(current.copy(content = current.tabularContent.appendRow(appendedRowId))),
                    current.id,
                    model,
                )
            ) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            val withRow = current.tabularContent.appendRow(appendedRowId)
            val contents = withRow.cellContents + calculatedCells.associate { CellCoordinate(appendedRowId, ColumnId(it.columnId)) to it.raw }
            workbook.replaceSheet(current.copy(content = TabularContent(withRow.rows, withRow.columns, contents)))
        }
        return RowAppendResult(sheet, sheet.tabularContent.rows.last())
    }

    override fun appendColumn(sheetId: String, expectedRevision: Long): ColumnAppendResult {
        val sheet = updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            if (current.dataModelId != null) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            workbook.replaceSheet(current.updateTabularContent(TabularContent::appendColumn))
        }
        return ColumnAppendResult(sheet, sheet.tabularContent.columns.last())
    }

    override fun replaceDataModelState(command: DataModelStateCommand): List<SheetDocument> {
        if (command.expectedRevisions.any { it.sheetId.toUuidBytesOrNull() == null || it.revision < 0 } ||
            command.expectedRevisions.map { it.sheetId }.distinct().size != command.expectedRevisions.size
        ) {
            throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        }
        val updated = dataModelState(command.workbook)
        lateinit var affectedSheetIds: Set<String>
        val persisted = store.updateWorkbook { current ->
            if (updated.manifest != current.manifest) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            affectedSheetIds = affectedDataModelSheets(current, updated)
            if (command.expectedRevisions.map(ExpectedSheetRevision::sheetId).toSet() != affectedSheetIds) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            command.expectedRevisions.forEach { expected ->
                val sheet = current.findSheet(SheetId(expected.sheetId))
                    ?: throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND)
                if (sheet.revision != expected.revision) throw SheetRevisionConflict(expected.sheetId, expected.revision, sheet.revision)
            }
            val changedDocuments = current.documents.keys.filter { current.documents.getValue(it) != updated.documents.getValue(it) }
            if (changedDocuments.any { it.value !in affectedSheetIds }) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            updated
        }
        return persisted.sheetsInOrder.filter { it.id.value in affectedSheetIds }
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

/** Decodes the same client bundle accepted by the data-model-state transport endpoint. */
internal fun dataModelState(bundle: WorkbookBundleResponse): WorkbookState {
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
                "calculated" -> property.formula?.takeIf(::isSupportedFormula)
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
        val content = TabularContent(rows, columns, cells)
        SheetId(response.id) to SheetDocument(SheetId(response.id), response.revision, response.name, FrameState(response.frame.position, response.frame.size, response.frame.visualScale, response.frame.zIndex), SheetPresentation(response.presentation.rowHeights, response.presentation.columnWidths, response.presentation.formatOverrides), content, response.dataModelId)
    }
    if (documents.keys.map { it.value } != bundle.manifest.sheetIds) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
    val state = WorkbookState(WorkbookManifest(bundle.manifest.version, bundle.manifest.revision, bundle.manifest.sheetIds.map(::SheetId)), documents, models)
    if (state.sheetsInOrder.any { sheet ->
            val model = sheet.dataModelId?.let(models::get)
            model != null && !hasOnlyModelOwnedCalculatedContents(state, sheet.id, model)
        }) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
    return state
}

private fun affectedDataModelSheets(current: WorkbookState, updated: WorkbookState): Set<String> {
    val changedModels = (current.dataModels.keys + updated.dataModels.keys)
        .filter { current.dataModels[it] != updated.dataModels[it] }
        .toSet()
    return current.documents.keys.map { it.value }.filter { id ->
        val before = current.documents.getValue(SheetId(id))
        val after = updated.documents.getValue(SheetId(id))
        before.dataModelId != after.dataModelId || before.dataModelId in changedModels
    }.toSet()
}

internal fun hasOnlyModelOwnedCalculatedContents(
    workbook: WorkbookState,
    sheetId: SheetId,
    model: DataModel,
): Boolean {
    val content = workbook.findSheet(sheetId)?.tabularContent ?: return false
    if (content.columns.size != model.properties.size) return false
    return model.properties.withIndex().filter { it.value is CalculatedDataModelProperty }.all { (index, property) ->
        val formula = (property as CalculatedDataModelProperty).formula
        content.rows.all { row ->
            val coordinate = CellCoordinate(row, content.columns[index])
            // A calculated cell is owned only when it is the exact canonical rendering of
            // its declared first-row template at this coordinate.  Formula "shape" is not
            // ownership: it loses the stable reference targets and anchors.
            content.cellContents[coordinate] == materializeModelFormula(formula, workbook, sheetId, coordinate)
        }
    }
}

private fun hasModelOwnedCalculatedAppends(
    cells: List<CalculatedCellAppend>,
    workbook: WorkbookState,
    sheetId: SheetId,
    model: DataModel?,
): Boolean {
    val content = workbook.findSheet(sheetId)?.tabularContent ?: return false
    return model?.properties?.withIndex()
    ?.filter { it.value is CalculatedDataModelProperty }
    ?.all { (index, property) ->
        val coordinate = CellCoordinate(content.rows.last(), content.columns[index])
        cells.single { it.columnId == coordinate.columnId.value }.raw ==
            materializeModelFormula((property as CalculatedDataModelProperty).formula, workbook, sheetId, coordinate)
    }
    ?: cells.isEmpty()
}

/**
 * The client stores formula references as stable column/row identifiers.  Model formulas are
 * first-row A1 templates. The persisted first-row canonical formula is authoritative for later
 * rows, so structural changes cannot silently retarget their stable references.
 */
internal fun materializeModelFormula(
    formula: String,
    workbook: WorkbookState,
    sheetId: SheetId,
    destination: CellCoordinate,
): String? {
    val content = workbook.findSheet(sheetId)?.tabularContent ?: return null
    val firstRow = content.rows.firstOrNull() ?: return null
    val source = CellCoordinate(firstRow, destination.columnId)
    if (destination.rowId == firstRow) return FormulaReferenceContract.canonicalize(formula, workbook, sheetId)
    val first = content.cellContents[source] ?: return null
    return FormulaReferenceContract.copyCanonical(first, source, destination, workbook, sheetId)
}

internal fun isSupportedFormula(raw: String): Boolean = FormulaReferenceContract.isFormula(raw)

/**
 * Storage accepts aggregate replacements from more than the HTTP application.  Keep the
 * model-owned shape and calculated contents invariant at that shared transactional boundary.
 */
internal fun hasValidChangedModelOwnership(current: WorkbookState, updated: WorkbookState): Boolean =
    updated.documents.values
        .filter { sheet ->
            val before = current.findSheet(sheet.id)
            before == null || before.dataModelId != sheet.dataModelId || before.tabularContent != sheet.tabularContent
        }
        .all { sheet ->
            val modelId = sheet.dataModelId ?: return@all true
            val model = updated.dataModels[modelId] ?: return@all false
            hasOnlyModelOwnedCalculatedContents(updated, sheet.id, model)
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
