package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SqliteWorkbookReaderTest {
    @Test
    fun `reader reports a present and absent stored schema version`() = withSqliteStore { store ->
        SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
            val reader = SqliteWorkbookReader(connection)
            assertEquals(WORKBOOK_SCHEMA_VERSION, reader.loadStoredSchemaVersion())
            connection.createStatement().use { it.executeUpdate("DELETE FROM workbook_metadata") }
            assertNull(reader.loadStoredSchemaVersion())
        } }
    }

    @Test
    fun `reader reports updated and missing sheet revisions`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", "newer")))
        SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
            val reader = SqliteWorkbookReader(connection)
            assertEquals(1, reader.loadSheetRevision(sheet.id))
            assertNull(reader.loadSheetRevision(SheetId(TEST_SHEET_2)))
        } }
    }
}
