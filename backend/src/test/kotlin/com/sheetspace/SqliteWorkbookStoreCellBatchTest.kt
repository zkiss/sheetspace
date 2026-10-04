package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteWorkbookStoreCellBatchTest {
    @Test
    fun `cell batches reject empty expected revisions without persisting`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val write = sheet.cellWrite("A1", "value")

        assertRejectedWithoutPersisting<IllegalArgumentException>(store) { store.writeCells(emptyList(), listOf(write)) }
    }

    @Test
    fun `cell batches reject duplicate writes without persisting`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val write = sheet.cellWrite("A1", "value")
        assertRejectedWithoutPersisting<IllegalArgumentException>(store) {
            store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(write, write))
        }
    }

    @Test
    fun `clearing an empty cell returns and persists a no op`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val unchanged = store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", ""))).single()
        assertEquals(0, unchanged.revision)
        assertEquals(emptyMap(), unchanged.tabularContent.cells)
        assertEquals(testWorkbookOf(unchanged), store.loadWorkbookBundle())
    }

    @Test
    fun `cell batches require writes without mutating persisted state`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", "saved")))

        assertRejectedWithoutPersisting<IllegalArgumentException>(store) {
            store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 1)), emptyList())
        }

    }

    @Test
    fun `cell batches require distinct expected revisions without mutating persisted state`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val write = sheet.cellWrite("A1", "saved")

        assertRejectedWithoutPersisting<IllegalArgumentException>(store) {
            store.writeCells(
                listOf(ExpectedSheetRevision(TEST_SHEET_1, 0), ExpectedSheetRevision(TEST_SHEET_1, 0)),
                listOf(write),
            )
        }

    }

    @Test
    fun `cell batches apply upserts deletions and idempotent writes`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val first = sheet.cellWrite("A1", "before")
        val second = sheet.cellWrite("B1", "remove")
        val afterUpsert = store.writeCells(listOf(ExpectedSheetRevision(sheet.id.value, 0)), listOf(first, second)).single()
        assertEquals(testWorkbookOf(afterUpsert), store.loadWorkbookBundle())
        val updated = store.writeCells(listOf(ExpectedSheetRevision(sheet.id.value, 1)), listOf(first.copy(raw = "after"), second.copy(raw = ""))).single()
        assertEquals(mapOf("A1" to "after"), updated.tabularContent.cells)
        assertEquals(testWorkbookOf(updated), store.loadWorkbookBundle())
        assertEquals(updated, store.writeCells(listOf(ExpectedSheetRevision(sheet.id.value, updated.revision)), listOf(first.copy(raw = "after"))).single())
        assertEquals(testWorkbookOf(updated), store.loadWorkbookBundle())
    }
}
