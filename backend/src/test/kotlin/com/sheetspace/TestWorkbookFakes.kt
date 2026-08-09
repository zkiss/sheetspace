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
        expectedRevision: ExpectedSheetRevision,
        writes: List<CellWrite>,
    ): SheetDocument = synchronized(this) {
        val sheetId = SheetId(expectedRevision.sheetId)
        val current = workbook.findSheet(sheetId)
            ?: throw NoSuchElementException("Sheet not found: ${sheetId.value}")
        if (current.revision != expectedRevision.revision) {
            throw SheetRevisionConflict(sheetId.value, expectedRevision.revision, current.revision)
        }
        val updatedContent = writes.fold(current.tabularContent) { content, write ->
            val address = content.addressOf(write.coordinate)
                ?: throw IllegalArgumentException("Cell coordinate does not belong to sheet")
            content.updateCell(address, write.content)
        }
        val updated = current
            .updateTabularContent { updatedContent }
            .copy(revision = current.revision + 1)
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
