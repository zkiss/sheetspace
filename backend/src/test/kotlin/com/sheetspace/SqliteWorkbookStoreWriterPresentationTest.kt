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
    fun `writer presentation rejects missing stale and empty requests`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val row = sheet.tabularContent.rows.first().value
        SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
            val writer = SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection))
            assertFailsWith<NoSuchElementException> { writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_2, 0), listOf(AxisSizeWrite("row", row, 30.0))) }
            assertFailsWith<SheetRevisionConflict> { writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 1), listOf(AxisSizeWrite("row", row, 30.0))) }
            assertFailsWith<WorkbookApplicationException> { writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList()) }
        } }
    }
}
