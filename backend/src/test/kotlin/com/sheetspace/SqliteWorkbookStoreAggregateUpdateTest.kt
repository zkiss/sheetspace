package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class SqliteWorkbookStoreAggregateUpdateTest {
    @Test
    fun `aggregate updates persist additions removals and changed fields`() = withSqliteStore { store ->
        val first = testDocument(TEST_SHEET_1, "Inputs")
        val second = testDocument(TEST_SHEET_2, "Outputs")
        store.saveWorkbook(testWorkbookOf(first))
        val changed = first.rename("Renamed").updateFrame { it.update(position = WorkspacePosition(7.0, 8.0)) }.updateTabularContent { it.copy(rowCount = DEFAULT_ROW_COUNT - 1, columnCount = DEFAULT_COLUMN_COUNT + 1) }
        store.updateWorkbook { it.replaceSheet(changed).addSheet(second) }
        store.updateWorkbook { it.removeSheet(second.id) }
        val loaded = store.loadSheet(first.id)!!
        assertEquals("Renamed", loaded.name)
        assertEquals(WorkspacePosition(7.0, 8.0), loaded.frame.position)
        assertEquals(DEFAULT_ROW_COUNT - 1, loaded.tabularContent.rowCount)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, loaded.tabularContent.columnCount)
        assertNull(store.loadSheet(second.id))
    }

    @Test
    fun `aggregate writes reject obsolete snapshots without overwriting newer cells`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val stale = store.loadWorkbookBundle()
        store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", "newer")))
        val before = store.loadWorkbookBundle()
        SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
            val writer = SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection))
            val conflict = assertFailsWith<SheetRevisionConflict> {
                writer.persistChanges(stale, stale.replaceSheet(stale.findSheet(sheet.id)!!.rename("Renamed")))
            }
            assertEquals(TEST_SHEET_1, conflict.sheetId)
            assertEquals(0, conflict.expectedRevision)
            assertEquals(1, conflict.actualRevision)
        } }
        assertEquals(before, store.loadWorkbookBundle())
    }

    @Test
    fun `aggregate writes leave the full bundle unchanged for an absent revision target`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val before = store.loadWorkbookBundle()

        val updated = store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_2, 0)) { it }

        assertEquals(before, updated)
        assertEquals(before, store.loadWorkbookBundle())
    }
}
