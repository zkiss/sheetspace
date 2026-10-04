package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteWorkbookStoreCellBatchTest {
    @Test
    fun `cell batches reject malformed writes and retain empty no op revisions`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val write = sheet.cellWrite("A1", "value")

        assertFailsWith<IllegalArgumentException> { store.writeCells(emptyList(), listOf(write)) }
        assertFailsWith<IllegalArgumentException> { store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(write, write)) }
        val unchanged = store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", ""))).single()
        assertEquals(0, unchanged.revision)
        assertEquals(emptyMap(), unchanged.tabularContent.cells)
    }

    @Test
    fun `cell batches require writes without mutating persisted state`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", "saved")))

        assertFailsWith<IllegalArgumentException> {
            store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 1)), emptyList())
        }

        assertEquals(mapOf("A1" to "saved"), store.loadSheet(SheetId(TEST_SHEET_1))!!.tabularContent.cells)
        assertEquals(1, store.loadSheet(SheetId(TEST_SHEET_1))!!.revision)
    }

    @Test
    fun `cell batches require distinct expected revisions without mutating persisted state`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val write = sheet.cellWrite("A1", "saved")

        assertFailsWith<IllegalArgumentException> {
            store.writeCells(
                listOf(ExpectedSheetRevision(TEST_SHEET_1, 0), ExpectedSheetRevision(TEST_SHEET_1, 0)),
                listOf(write),
            )
        }

        val persisted = store.loadSheet(SheetId(TEST_SHEET_1))!!
        assertEquals(emptyMap(), persisted.tabularContent.cells)
        assertEquals(0, persisted.revision)
    }

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
