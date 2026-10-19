package com.sheetspace

class InMemoryWorkbookStore(
    initialWorkbook: WorkbookState = emptyWorkbookState(),
) : WorkbookStore {
    init {
        require(DataModelTransitionPolicy.permitsBootstrap(initialWorkbook)) {
            "Initial workbook must satisfy the same aggregate validation as persistent bootstrap"
        }
    }

    private var workbook = initialWorkbook

    override fun loadManifest(): WorkbookManifest = synchronized(this) { workbook.manifest }

    override fun loadSheet(sheetId: SheetId): SheetDocument? =
        synchronized(this) { workbook.findSheet(sheetId) }

    override fun loadWorkbookBundle(): WorkbookState = synchronized(this) { workbook }

    override fun saveWorkbook(
        workbook: WorkbookState,
        expectedManifestRevision: Long?,
        expectedSheetRevisions: List<ExpectedSheetRevision>,
    ) {
        require(workbook.manifest.version == WORKBOOK_SCHEMA_VERSION)
        synchronized(this) {
            val isPristine = this.workbook == emptyWorkbookState()
            val isTransition = !isPristine && DataModelTransitionPolicy.requiresAggregateCas(this.workbook, workbook)
            val requiresSheetBaseline = !isPristine && DataModelTransitionPolicy.requiresBoundAppendCas(this.workbook, workbook)
            if (isTransition && expectedManifestRevision != this.workbook.manifest.revision) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            if (isTransition) validateAffectedSheetRevisions(this.workbook, workbook, expectedSheetRevisions)
            if (requiresSheetBaseline) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            if (!(if (isPristine) DataModelTransitionPolicy.permitsBootstrap(workbook)
                else DataModelTransitionPolicy.permitsTransition(this.workbook, workbook))) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            val persisted = if (isTransition) workbook.copy(manifest = workbook.manifest.copy(revision = this.workbook.manifest.revision + 1)) else workbook
            this.workbook = persisted
        }
    }

    override fun writeCells(
        expectedRevisions: List<ExpectedSheetRevision>,
        writes: List<SheetCellWrite>,
    ): List<SheetDocument> = synchronized(this) {
        val order = writes.map(SheetCellWrite::sheetId).distinct()
        require(order.toSet() == expectedRevisions.map(ExpectedSheetRevision::sheetId).toSet())
        val current = order.associateWith { sheetId ->
            workbook.findSheet(SheetId(sheetId)) ?: throw NoSuchElementException("Sheet not found: $sheetId")
        }
        writes.forEach { write ->
            val sheet = current.getValue(write.sheetId)
            val model = sheet.dataModelId?.let(workbook.dataModels::get) ?: return@forEach
            val columnIndex = sheet.tabularContent.columns.indexOf(ColumnId(write.columnId))
            if (model.properties.getOrNull(columnIndex) is CalculatedDataModelProperty) {
                throw WorkbookApplicationException(WorkbookApplicationError.READ_ONLY_CALCULATED_CELL)
            }
        }
        expectedRevisions.forEach { expected ->
            val sheet = current.getValue(expected.sheetId)
            if (sheet.revision != expected.revision) throw SheetRevisionConflict(expected.sheetId, expected.revision, sheet.revision)
        }
        var updatedWorkbook = workbook
        order.forEach { sheetId ->
            val sheet = current.getValue(sheetId)
            val updatedContent = writes.filter { it.sheetId == sheetId }.fold(sheet.tabularContent) { content, write ->
                content.addressOf(CellCoordinate(RowId(write.rowId), ColumnId(write.columnId)))
                    ?.let { address -> content.updateCell(address, write.raw) }
                    ?: throw IllegalArgumentException("Cell coordinate does not belong to sheet")
            }
            if (updatedContent != sheet.tabularContent) {
                updatedWorkbook = updatedWorkbook.replaceSheet(
                    sheet.updateTabularContent { updatedContent }.copy(revision = sheet.revision + 1),
                )
            }
        }
        workbook = updatedWorkbook
        order.map { workbook.documents.getValue(SheetId(it)) }
    }

    override fun writePresentation(expectedRevision: ExpectedSheetRevision, writes: List<AxisSizeWrite>, formatWrites: List<FormatWrite>): SheetDocument = synchronized(this) {
        val current = workbook.findSheet(SheetId(expectedRevision.sheetId)) ?: throw NoSuchElementException("Sheet not found")
        if (current.revision != expectedRevision.revision) throw SheetRevisionConflict(expectedRevision.sheetId, expectedRevision.revision, current.revision)
        if (writes.isEmpty() && formatWrites.isEmpty()) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_PRESENTATION)
        val sized = if (writes.isEmpty()) current.presentation else validatedPresentationWrites(current, writes)
        val formatted = if (formatWrites.isEmpty()) sized else validatedFormatWrites(current.copy(presentation = sized), formatWrites)
        val updated = current.copy(presentation = formatted, revision = current.revision + 1)
        workbook = workbook.replaceSheet(updated)
        updated
    }

    override fun updateSheetZOrder(writes: List<SheetZOrderWrite>): List<SheetDocument> = synchronized(this) {
        require(writes.isNotEmpty())
        require(writes.map { it.expectedRevision.sheetId }.distinct().size == writes.size)
        val current = workbook
        val currentSheets = writes.associateWith { write ->
            val expected = write.expectedRevision
            val sheet = current.findSheet(SheetId(expected.sheetId))
                ?: throw NoSuchElementException("Sheet not found: ${expected.sheetId}")
            if (sheet.revision != expected.revision) {
                throw SheetRevisionConflict(expected.sheetId, expected.revision, sheet.revision)
            }
            sheet
        }
        workbook = writes.fold(current) { updated, write ->
            val sheet = currentSheets.getValue(write)
            updated.replaceSheet(
                sheet.updateFrame { frame -> frame.update(zIndex = write.zIndex) }
                    .copy(revision = sheet.revision + 1),
            )
        }
        writes.map { workbook.documents.getValue(SheetId(it.expectedRevision.sheetId)) }
    }

    override fun updateWorkbook(
        expectedRevision: ExpectedSheetRevision?,
        expectedManifestRevision: Long?,
        expectedSheetRevisions: List<ExpectedSheetRevision>,
        transform: (WorkbookState) -> WorkbookState,
    ): WorkbookState = synchronized(this) {
        val current = workbook
        val transformed = transform(current)
        val hasModelTransition = DataModelTransitionPolicy.requiresAggregateCas(current, transformed)
        val requiresSheetBaseline = DataModelTransitionPolicy.requiresBoundAppendCas(current, transformed)
        val changedBoundSheets = DataModelTransitionPolicy.boundContentChanges(current, transformed)
        if (hasModelTransition && expectedManifestRevision != current.manifest.revision) {
            throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        }
        if (hasModelTransition) validateAffectedSheetRevisions(current, transformed, expectedSheetRevisions)
        if (requiresSheetBaseline && (expectedRevision == null || SheetId(expectedRevision.sheetId) !in changedBoundSheets)) {
            throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        }
        val authorized = if (hasModelTransition) transformed.copy(manifest = current.manifest) else transformed
        if (!DataModelTransitionPolicy.permitsTransition(current, authorized)) {
            throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        }
        val updated = if (hasModelTransition) authorized.copy(manifest = current.manifest.copy(revision = current.manifest.revision + 1)) else transformed
        workbook = if (expectedRevision == null) {
            updated
        } else {
            applyRevision(current, updated, expectedRevision)
        }
        workbook
    }

    private fun validateAffectedSheetRevisions(
        current: WorkbookState,
        candidate: WorkbookState,
        expected: List<ExpectedSheetRevision>,
    ) {
        val affected = DataModelTransitionPolicy.affectedAggregateSheets(current, candidate)
        if (expected.map(ExpectedSheetRevision::sheetId).distinct().size != expected.size ||
            expected.map { SheetId(it.sheetId) }.toSet() != affected
        ) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        expected.forEach { guard ->
            val sheet = current.documents.getValue(SheetId(guard.sheetId))
            if (sheet.revision != guard.revision) throw SheetRevisionConflict(guard.sheetId, guard.revision, sheet.revision)
        }
    }

    private fun applyRevision(
        current: WorkbookState,
        updated: WorkbookState,
        expected: ExpectedSheetRevision,
    ): WorkbookState {
        val sheetId = SheetId(expected.sheetId)
        val currentSheet = current.findSheet(sheetId)
        if (currentSheet != null && currentSheet.revision != expected.revision) {
            throw SheetRevisionConflict(expected.sheetId, expected.revision, currentSheet.revision)
        }
        val updatedSheet = updated.findSheet(sheetId)
        if (currentSheet == null || updatedSheet == null || currentSheet == updatedSheet) {
            return updated
        }
        return updated.replaceSheet(updatedSheet.copy(revision = currentSheet.revision + 1))
    }
}

class StatefulFakeWorkbookApplication(
    store: InMemoryWorkbookStore = InMemoryWorkbookStore(),
) : WorkbookApplication by DefaultWorkbookApplication(store)

internal fun WorkbookApplication.writeOneCell(sheetId: String, address: String, raw: String, revision: Long): SheetDocument {
    val sheet = loadSheet(sheetId)
    val coordinate = sheet.tabularContent.coordinateAt(address) ?: error("Unknown test address: $address")
    return writeCells(
        CellPatchCommand(
            listOf(ExpectedSheetRevision(sheetId, revision)),
            listOf(SheetCellWrite(sheetId, coordinate.rowId.value, coordinate.columnId.value, raw)),
        ),
    ).single()
}

internal fun SheetDocument.cellWrite(address: String, raw: String): SheetCellWrite {
    val coordinate = tabularContent.coordinateAt(address) ?: error("Unknown test address: $address")
    return SheetCellWrite(id.value, coordinate.rowId.value, coordinate.columnId.value, raw)
}

internal fun SheetDocument.unboundWithCalculatedScalars(): SheetDocument = copy(
    dataModelId = null,
    content = TabularContent(
        tabularContent.rows,
        tabularContent.columns,
        tabularContent.cellContents.mapValues { (coordinate, raw) ->
            if (coordinate.columnId == tabularContent.columns[1] && raw.startsWith("=")) "10" else raw
        },
    ),
)
