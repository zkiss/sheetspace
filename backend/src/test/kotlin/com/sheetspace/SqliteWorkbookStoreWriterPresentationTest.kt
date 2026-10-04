package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertEquals

class SqliteWorkbookStoreWriterPresentationTest {
    @Test
    fun `writer persists independent size and format presentation changes`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val row = sheet.tabularContent.rows.first().value
        SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
            val writer = SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection))
            val sized = writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(AxisSizeWrite("row", row, 30.0)))
            assertEquals(1, sized.revision)
            val formatted = writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 1), emptyList(), listOf(FormatWrite("row", row, NumberFormat("number", 2))))
            assertEquals(NumberFormat("number", 2), formatted.presentation.formatOverrides.rows[row]?.numberFormat)
        } }
    }

    @Test
    fun `writer presentation rejects a missing sheet without persisting`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val row = sheet.tabularContent.rows.first().value
        assertRejectedWithoutPersisting<NoSuchElementException>(store) {
            SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
                SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection))
                    .writePresentation(ExpectedSheetRevision(TEST_SHEET_2, 0), listOf(AxisSizeWrite("row", row, 30.0)))
            } }
        }
    }

    @Test
    fun `writer presentation rejects a stale revision without persisting`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val row = sheet.tabularContent.rows.first().value
        val conflict = assertRejectedWithoutPersisting<SheetRevisionConflict>(store) {
            SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
                SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection))
                    .writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 1), listOf(AxisSizeWrite("row", row, 30.0)))
            } }
        }
        assertEquals(TEST_SHEET_1, conflict.sheetId)
        assertEquals(1, conflict.expectedRevision)
        assertEquals(0, conflict.actualRevision)
    }

    @Test
    fun `writer presentation rejects an empty request without persisting`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val exception = assertRejectedWithoutPersisting<WorkbookApplicationException>(store) {
            SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
                SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection))
                    .writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList())
            } }
        }
        assertEquals(WorkbookApplicationError.INVALID_SHEET_PRESENTATION, exception.error)
    }
}
