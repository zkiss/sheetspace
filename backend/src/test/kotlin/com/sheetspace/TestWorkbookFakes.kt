package com.sheetspace

class InMemoryWorkbookStore(
    initialWorkbook: Workbook = emptyWorkbook(),
) : WorkbookStore {
    private var workbook = initialWorkbook

    override fun loadWorkbook(): Workbook = synchronized(this) { workbook }

    override fun saveWorkbook(workbook: Workbook) {
        require(workbook.version == WORKBOOK_SCHEMA_VERSION)
        synchronized(this) {
            this.workbook = workbook
        }
    }

    override fun updateWorkbook(
        expectedRevision: ExpectedSheetRevision?,
        transform: (Workbook) -> Workbook,
    ): Workbook = synchronized(this) {
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
        current: Workbook,
        updated: Workbook,
        expected: ExpectedSheetRevision,
    ): Workbook {
        val currentSheet = current.sheets.find { it.id == expected.sheetId }
        if (currentSheet != null && currentSheet.revision != expected.revision) {
            throw SheetRevisionConflict(expected.sheetId, expected.revision, currentSheet.revision)
        }
        val updatedSheet = updated.sheets.find { it.id == expected.sheetId }
        if (currentSheet == null || updatedSheet == null || currentSheet == updatedSheet) {
            return updated
        }
        return updated.copy(
            sheets = updated.sheets.map { sheet ->
                if (sheet.id == expected.sheetId) {
                    sheet.copy(revision = currentSheet.revision + 1)
                } else {
                    sheet
                }
            },
        )
    }
}

class StatefulFakeWorkbookApplication(
    store: InMemoryWorkbookStore = InMemoryWorkbookStore(),
) : WorkbookApplication by DefaultWorkbookApplication(store)
