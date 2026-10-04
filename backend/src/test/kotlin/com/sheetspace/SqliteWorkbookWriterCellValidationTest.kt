package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteWorkbookWriterCellValidationTest {
    @Test
    fun `writer persists a cell with sheet owned row and column`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))

        val updated = SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
            SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection)).writeCells(
                listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
                listOf(sheet.cellWrite("A1", "value")),
            ).single()
        } }

        assertEquals(1, updated.revision)
        assertEquals("value", updated.tabularContent.cells["A1"])
        assertEquals(updated, store.loadSheet(SheetId(TEST_SHEET_1)))
    }

    @Test
    fun `writer rejects mismatched expected sheets without persisting`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        assertRejectedWithoutPersisting<IllegalArgumentException>(store) {
            SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
                SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection)).writeCells(emptyList(), listOf(sheet.cellWrite("A1", "value")))
            } }
        }
    }

    @Test
    fun `writer rejects a missing cell sheet without persisting`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        assertRejectedWithoutPersisting<NoSuchElementException>(store) {
            SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
                SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection)).writeCells(
                    listOf(ExpectedSheetRevision(TEST_SHEET_2, 0)),
                    listOf(SheetCellWrite(TEST_SHEET_2, sheet.tabularContent.rows.first().value, sheet.tabularContent.columns.first().value, "value")),
                )
            } }
        }
    }

    @Test
    fun `writer rejects a foreign row without persisting`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        assertRejectedWithoutPersisting<IllegalArgumentException>(store) {
            SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
                SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection)).writeCells(
                    listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
                    listOf(SheetCellWrite(TEST_SHEET_1, RowId.generate().value, sheet.tabularContent.columns.first().value, "value")),
                )
            } }
        }
    }

    @Test
    fun `writer rejects a foreign column without persisting`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        assertRejectedWithoutPersisting<IllegalArgumentException>(store) {
            SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
                SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection)).writeCells(
                    listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
                    listOf(SheetCellWrite(TEST_SHEET_1, sheet.tabularContent.rows.first().value, ColumnId.generate().value, "value")),
                )
            } }
        }
    }
}
