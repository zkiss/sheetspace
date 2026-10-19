package com.sheetspace

import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
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

    @Test
    fun `reader rejects a persisted sheet model reference without a declaration`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            connection.prepareStatement("UPDATE sheet_documents SET model_id = ? WHERE id = ?").use { statement ->
                statement.setBytes(1, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa".toUuidBytes())
                statement.setBytes(2, sheet.id.value.toUuidBytes())
                statement.executeUpdate()
            }
        }

        assertFailsWith<IllegalArgumentException> { store.loadWorkbookBundle() }
    }
}
