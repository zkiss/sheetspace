package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SqliteWorkbookReaderTest {
    @Test
    fun `reader reports schema versions and sheet revisions`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", "newer")))
        SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
            val reader = SqliteWorkbookReader(connection)
            assertEquals(WORKBOOK_SCHEMA_VERSION, reader.loadStoredSchemaVersion())
            assertEquals(1, reader.loadSheetRevision(sheet.id))
            assertNull(reader.loadSheetRevision(SheetId(TEST_SHEET_2)))
            connection.createStatement().use { it.executeUpdate("DELETE FROM workbook_metadata") }
            assertNull(reader.loadStoredSchemaVersion())
        } }
    }
}
