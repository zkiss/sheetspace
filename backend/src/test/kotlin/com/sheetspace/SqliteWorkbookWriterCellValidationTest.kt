package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFailsWith

class SqliteWorkbookWriterCellValidationTest {
    @Test
    fun `writer rejects missing and out of bounds cell targets`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
            val writer = SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection))
            assertFailsWith<IllegalArgumentException> { writer.writeCells(emptyList(), listOf(sheet.cellWrite("A1", "value"))) }
            assertFailsWith<NoSuchElementException> { writer.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_2, 0)), listOf(SheetCellWrite(TEST_SHEET_2, sheet.tabularContent.rows.first().value, sheet.tabularContent.columns.first().value, "value"))) }
            assertFailsWith<IllegalArgumentException> { writer.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(SheetCellWrite(TEST_SHEET_1, RowId.generate().value, sheet.tabularContent.columns.first().value, "value"))) }
            assertFailsWith<IllegalArgumentException> { writer.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(SheetCellWrite(TEST_SHEET_1, sheet.tabularContent.rows.first().value, ColumnId.generate().value, "value"))) }
        } }
    }
}
