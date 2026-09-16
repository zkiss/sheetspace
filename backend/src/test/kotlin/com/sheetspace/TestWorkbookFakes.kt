package com.sheetspace

class InMemoryWorkbookStore(
    initialWorkbook: WorkbookState = emptyWorkbookState(),
) : WorkbookStore {
    private var workbook = initialWorkbook

    override fun loadManifest(): WorkbookManifest = synchronized(this) { workbook.manifest }

    override fun loadSheet(sheetId: SheetId): SheetDocument? =
        synchronized(this) { workbook.findSheet(sheetId) }

    override fun loadWorkbookBundle(): WorkbookState = synchronized(this) { workbook }

    override fun saveWorkbook(workbook: WorkbookState) {
        require(workbook.manifest.version == WORKBOOK_SCHEMA_VERSION)
        synchronized(this) {
            this.workbook = workbook
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

    override fun writePresentation(expectedRevision: ExpectedSheetRevision, writes: List<AxisSizeWrite>): SheetDocument = synchronized(this) {
        val current = workbook.findSheet(SheetId(expectedRevision.sheetId)) ?: throw NoSuchElementException("Sheet not found")
        if (current.revision != expectedRevision.revision) throw SheetRevisionConflict(expectedRevision.sheetId, expectedRevision.revision, current.revision)
        val updated = current.copy(presentation = validatedPresentationWrites(current, writes), revision = current.revision + 1)
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
        transform: (WorkbookState) -> WorkbookState,
    ): WorkbookState = synchronized(this) {
        val current = workbook
        val updated = transform(current)
        workbook = if (expectedRevision == null) {
            updated
        } else {
            applyRevision(current, updated, expectedRevision)
        }
        workbook
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
