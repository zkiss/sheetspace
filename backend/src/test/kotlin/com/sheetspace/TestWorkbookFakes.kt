package com.sheetspace

class InMemoryWorkbookStore(
    initialWorkbook: WorkbookState = emptyWorkbookState(),
) : WorkbookStore {
    private var workbook = initialWorkbook

    override fun loadWorkbook(): WorkbookState = synchronized(this) { workbook }

    override fun saveWorkbook(workbook: WorkbookState) {
        require(workbook.manifest.version == WORKBOOK_SCHEMA_VERSION)
        synchronized(this) {
            this.workbook = workbook
        }
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
