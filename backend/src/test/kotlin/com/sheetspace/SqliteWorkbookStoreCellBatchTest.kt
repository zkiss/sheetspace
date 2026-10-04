package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals

class SqliteWorkbookStoreCellBatchTest {
    @Test
    fun `cell batches apply upserts deletions and idempotent writes`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val first = sheet.cellWrite("A1", "before")
        val second = sheet.cellWrite("B1", "remove")
        store.writeCells(listOf(ExpectedSheetRevision(sheet.id.value, 0)), listOf(first, second))
        val updated = store.writeCells(listOf(ExpectedSheetRevision(sheet.id.value, 1)), listOf(first.copy(raw = "after"), second.copy(raw = ""))).single()
        assertEquals(mapOf("A1" to "after"), updated.tabularContent.cells)
        assertEquals(updated, store.writeCells(listOf(ExpectedSheetRevision(sheet.id.value, updated.revision)), listOf(first.copy(raw = "after"))).single())
    }
}
