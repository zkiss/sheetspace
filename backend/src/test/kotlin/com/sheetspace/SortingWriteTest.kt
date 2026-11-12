package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals

class SortingWriteTest {
    @Test
    fun `sorting and row order persist together without altering cells or presentation`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs", tabular = TabularContent(cells = mapOf("A1" to "=B2")))
        store.saveWorkbook(testWorkbookOf(sheet))
        val app = DefaultWorkbookApplication(store)
        val rows = sheet.tabularContent.rows.map(RowId::value)
        val sorting = listOf(SortCriterion(sheet.tabularContent.columns.first().value, "descending"))
        val saved = app.writeSorting(TEST_SHEET_1, 0, sorting, rows.reversed())
        assertEquals(sorting, saved.sorting)
        assertEquals(rows.reversed(), saved.tabularContent.rows.map(RowId::value))
        assertEquals(sheet.tabularContent.cellContents, saved.tabularContent.cellContents)
        assertEquals(sheet.presentation, saved.presentation)
        assertEquals(saved, store.loadSheet(sheet.id))
        assertEquals(saved, app.writeSorting(TEST_SHEET_1, saved.revision, sorting, rows.reversed()))
        val cleared = app.writeSorting(TEST_SHEET_1, saved.revision, emptyList(), rows.reversed())
        assertEquals(emptyList(), cleared.sorting)
        assertEquals(rows.reversed(), cleared.tabularContent.rows.map(RowId::value))
    }

    @Test
    fun `invalid sorting order and stale revisions do not mutate the workbook`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val app = DefaultWorkbookApplication(store)
        val rows = sheet.tabularContent.rows.map(RowId::value)
        val column = sheet.tabularContent.columns.first().value
        listOf(listOf(SortCriterion("bad", "ascending")), listOf(SortCriterion(column, "bad")),
            listOf(SortCriterion(column, "ascending"), SortCriterion(column, "descending"))).forEach { sorting ->
            val error = assertRejectedWithoutPersisting<WorkbookApplicationException>(store) { app.writeSorting(TEST_SHEET_1, 0, sorting, rows) }
            assertEquals(WorkbookApplicationError.INVALID_SORTING, error.error)
        }
        assertRejectedWithoutPersisting<WorkbookApplicationException>(store) { app.writeSorting(TEST_SHEET_1, 0, emptyList(), rows.drop(1)) }
        assertRejectedWithoutPersisting<SheetRevisionConflict>(store) { app.writeSorting(TEST_SHEET_1, 1, emptyList(), rows) }
    }
}
