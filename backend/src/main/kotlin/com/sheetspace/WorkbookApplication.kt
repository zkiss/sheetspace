package com.sheetspace

import java.security.MessageDigest

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

data class UpdateSheetModelCommand(val modelId: String?, val modelColumnBindings: Map<String, ColumnId>? = null)

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
    CALCULATED_CELL_WRITE,
    INVALID_SHEET_PRESENTATION,
    INVALID_DATA_MODEL,
    UNKNOWN_DATA_MODEL,
    INVALID_MODEL_LIFECYCLE,
    MODEL_LIFECYCLE_CONFLICT,
    BOUND_SHEET_STRUCTURE,
    INVALID_MODEL_RECORD,
}

class WorkbookApplicationException(
    val error: WorkbookApplicationError,
) : RuntimeException("Workbook operation rejected: $error")

interface WorkbookApplication {
    fun saveModelLifecycle(before: WorkbookState, after: WorkbookState): WorkbookState
    fun loadManifest(): WorkbookManifest

    fun loadWorkbookBundle(): WorkbookState

    fun loadSheet(sheetId: String): SheetDocument

    fun createSheet(command: CreateSheetCommand): SheetDocument

    fun updateSheet(sheetId: String, expectedRevision: Long, command: UpdateSheetCommand): SheetDocument

    fun writePresentation(sheetId: String, expectedRevision: Long, writes: List<AxisSizeWrite>, formatWrites: List<FormatWrite> = emptyList()): SheetDocument

    fun updateSheetZOrder(updates: List<SheetZOrderUpdate>): List<SheetDocument>

    fun deleteSheet(sheetId: String, expectedRevision: Long)

    /** Ordinary content editing; a target owned by a calculated property is rejected before any write. */
    fun writeCells(command: CellPatchCommand): List<SheetDocument>

    fun appendRow(sheetId: String, expectedRevision: Long): RowAppendResult

    fun appendColumn(sheetId: String, expectedRevision: Long): ColumnAppendResult

    fun admitRecord(sheetId: String, expectedRevision: Long, rowId: String, values: Map<String, String>): RowAppendResult

    fun saveDataModel(model: DataModel): DataModel

    fun updateSheetModel(sheetId: String, command: UpdateSheetModelCommand): SheetDocument
}

class DefaultWorkbookApplication(
    private val store: WorkbookStore,
    private val recordValidation: RecordValueValidation = SharedRecordValueValidation,
) : WorkbookApplication {
    override fun saveModelLifecycle(before: WorkbookState, after: WorkbookState): WorkbookState =
        store.updateWorkbook { current ->
            val reconciled = reconcileModelLifecycle(current, before, after)
            if (!calculatedTransitionIsValid(current, reconciled)) {
                throw WorkbookApplicationException(WorkbookApplicationError.CALCULATED_CELL_WRITE)
            }
            reconciled
        }
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
            // Removing a sheet invalidates the derived instances that reference it, so the
            // dependent sheets are materialized in the same operation.
            materializeDerivedContents(workbook.removeSheet(id))
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
        val sheetsById = command.cells.map(SheetCellWrite::sheetId).distinct().associateWith { sheetId -> loadSheet(sheetId) }
        command.cells.forEach { write ->
            val sheet = sheetsById.getValue(write.sheetId)
            if (RowId(write.rowId) !in sheet.tabularContent.rows || ColumnId(write.columnId) !in sheet.tabularContent.columns) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_COORDINATE)
            }
        }
        command.expectedRevisions.forEach { expected -> loadSheet(expected.sheetId) }
        val dataModels = store.loadDataModels()
        command.cells.forEach { write ->
            val sheet = sheetsById.getValue(write.sheetId)
            if (ColumnId(write.columnId) in calculatedModelColumns(sheet, dataModels)) {
                throw WorkbookApplicationException(WorkbookApplicationError.CALCULATED_CELL_WRITE)
            }
        }
        return store.writeCells(command.expectedRevisions, command.cells)
    }

    override fun appendRow(sheetId: String, expectedRevision: Long): RowAppendResult {
        val sheet = updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            if (current.modelId != null) throw WorkbookApplicationException(WorkbookApplicationError.BOUND_SHEET_STRUCTURE)
            val appended = current.updateTabularContent(TabularContent::appendRow)
            val provisional = workbook.replaceSheet(appended)
            provisional.replaceSheet(materializeCalculatedRow(provisional, appended, appended.tabularContent.rows.last()))
        }
        return RowAppendResult(sheet, sheet.tabularContent.rows.last())
    }

    override fun appendColumn(sheetId: String, expectedRevision: Long): ColumnAppendResult {
        val sheet = updateExistingSheet(sheetId, expectedRevision) { workbook, current ->
            if (current.modelId != null) throw WorkbookApplicationException(WorkbookApplicationError.BOUND_SHEET_STRUCTURE)
            workbook.replaceSheet(current.updateTabularContent(TabularContent::appendColumn))
        }
        return ColumnAppendResult(sheet, sheet.tabularContent.columns.last())
    }

    override fun admitRecord(sheetId: String, expectedRevision: Long, rowId: String, values: Map<String, String>): RowAppendResult {
        if (rowId.toUuidBytesOrNull() == null || expectedRevision < 0) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)
        if (sheetId.toUuidBytesOrNull() == null) throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND)
        val id = SheetId(sheetId)
        val row = RowId(rowId.toUuidBytesOrNull()!!.toUuidString())
        val fingerprint = recordFingerprint(expectedRevision, values)
        val updated = store.admitRecord(id, row, fingerprint) { workbook ->
            val sheet = workbook.findSheet(id) ?: throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND)
            val model = sheet.modelId?.let(workbook.dataModels::get) ?: throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)
            val manual = model.columns.filterIsInstance<ManualModelColumn>()
            if (values.keys != manual.map { it.id }.toSet() || model.columns.any { sheet.modelColumnBindings[it.id] !in sheet.tabularContent.columns } ||
                !recordValidation.valid(workbook, id, values)) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)
            }
            val contents = sheet.tabularContent.cellContents
            if (row in sheet.tabularContent.rows) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)
            if (sheet.revision != expectedRevision) throw SheetRevisionConflict(sheetId, expectedRevision, sheet.revision)
            val writes = manual.mapNotNull { property ->
                values.getValue(property.id).takeIf(String::isNotEmpty)?.let { CellCoordinate(row, sheet.modelColumnBindings.getValue(property.id)) to it }
            }.toMap()
            val content = TabularContent(sheet.tabularContent.rows + row, sheet.tabularContent.columns, contents + writes)
            val appended = sheet.copy(content = content)
            val provisional = workbook.replaceSheet(appended)
            provisional.replaceSheet(materializeCalculatedRow(provisional, appended, row))
        }
        return RowAppendResult(updated.documents.getValue(id), row)
    }

    override fun saveDataModel(model: DataModel): DataModel {
        if (!isValidDataModel(model)) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_DATA_MODEL)
        return store.updateWorkbook { workbook ->
            val previous = workbook.dataModels[model.id]
            if (
                previous != null &&
                workbook.documents.values.any { it.modelId == model.id } &&
                previous.calculatedFormulasByProperty() != model.calculatedFormulasByProperty()
            ) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
            }
            val propertyIds = model.columns.map(ModelColumn::id).toSet()
            val updated = workbook.copy(
                dataModels = workbook.dataModels + (model.id to model),
                documents = workbook.documents.mapValues { (_, sheet) ->
                    if (sheet.modelId != model.id) sheet else sheet.copy(
                        modelColumnBindings = sheet.modelColumnBindings.filterKeys(propertyIds::contains),
                        modelFormulaBindings = retainDeclaredCalculatedTemplates(model, sheet.modelFormulaBindings) { template, declaration ->
                            preparedModelTemplateIsValid(template, declaration)
                        },
                    )
                },
            )
            if (updated.documents.values.any { !validColumnNames(it, updated.dataModels) }) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_DATA_MODEL)
            }
            updated
        }.dataModels.getValue(model.id)
    }

    override fun updateSheetModel(sheetId: String, command: UpdateSheetModelCommand): SheetDocument {
        val id = SheetId(sheetId)
        return store.updateWorkbook { workbook ->
            val sheet = workbook.findSheet(id)
                ?: throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND)
            if (command.modelId != null && command.modelId !in workbook.dataModels) {
                throw WorkbookApplicationException(WorkbookApplicationError.UNKNOWN_DATA_MODEL)
            }
            val bindings = command.modelColumnBindings ?: command.modelId?.let { modelId ->
                workbook.dataModels.getValue(modelId).columns.zip(sheet.tabularContent.columns)
                    .associate { (property, column) -> property.id to column }
            }.orEmpty()
            if (sheet.modelId == command.modelId && sheet.modelColumnBindings == bindings) return@updateWorkbook workbook
            val updated = sheet.copy(modelId = command.modelId, modelColumnBindings = bindings)
            if (!validModelColumnBindings(updated, workbook.dataModels)) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_DATA_MODEL)
            }
            if (!validColumnNames(updated, workbook.dataModels)) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_DATA_MODEL)
            }
            val model = command.modelId?.let(workbook.dataModels::get)
            if (model?.columns?.any { it is CalculatedModelColumn } == true) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
            }
            val withoutFormulaBindings = updated.copy(modelFormulaBindings = null)
            // Detaching a sheet invalidates the derived instances that reference it, so the
            // dependent sheets are materialized in the same operation.
            materializeDerivedContents(workbook.replaceSheet(withoutFormulaBindings))
        }.documents.getValue(id)
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

private fun recordFingerprint(revision: Long, values: Map<String, String>): String {
    val payload = buildString {
        append(revision).append(':')
        values.toSortedMap().forEach { (key, value) -> append(key.length).append(':').append(key).append(value.length).append(':').append(value) }
    }
    return MessageDigest.getInstance("SHA-256").digest(payload.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

private fun DataModel.calculatedFormulasByProperty(): Map<String, String> =
    columns.filterIsInstance<CalculatedModelColumn>().associate { it.id to it.formula }

internal fun isValidDataModel(model: DataModel): Boolean {
    if (model.id.toUuidBytesOrNull() == null || model.name.isBlank()) return false
    if (model.columns.map(ModelColumn::id).distinct().size != model.columns.size) return false
    if (model.columns.map { it.name.trim() }.distinct().size != model.columns.size) return false
    return model.columns.all { column ->
        column.id.toUuidBytesOrNull() != null && column.name.isNotBlank() &&
            (column !is CalculatedModelColumn || column.formula.isNotBlank())
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
