package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

/** Focused low-level SQLite reader, writer, and store boundary cases. */
class SqliteWorkbookStoreBoundaryTest {
    @Test
    fun `tabular address parsing rejects invalid and foreign coordinates`() {
        val content = TabularContent(columnCount = 1, rowCount = 1)
        assertNull(content.coordinateAt("A0")); assertNull(content.coordinateAt("A999999999999999999999")); assertNull(content.coordinateAt("ZZZZZZZZZZ1"))
        assertNull(content.addressOf(CellCoordinate(RowId.generate(), content.columns.first())))
        assertNull(content.addressOf(CellCoordinate(content.rows.first(), ColumnId.generate())))
        assertFailsWith<IllegalArgumentException> { content.copy(columnCount = -1) }
        assertFailsWith<IllegalArgumentException> { content.copy(rowCount = -1) }
        assertEquals(false, content.equals("not tabular"))
    }

    @Test
    fun `cell store rejects malformed batches and retains no op revision`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs"); store.saveWorkbook(testWorkbookOf(sheet))
        assertFailsWith<IllegalArgumentException> { store.writeCells(emptyList(), listOf(sheet.cellWrite("A1", "value"))) }
        assertFailsWith<IllegalArgumentException> { store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", "one"), sheet.cellWrite("A1", "two"))) }
        val unchanged = store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", ""))).single()
        assertEquals(0, unchanged.revision); assertEquals(emptyMap(), unchanged.tabularContent.cells)
    }

    @Test
    fun `writer presentation rejects missing stale and empty writes`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs"); store.saveWorkbook(testWorkbookOf(sheet)); val row = sheet.tabularContent.rows.first().value
        SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
            val writer = SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection))
            assertFailsWith<NoSuchElementException> { writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_2, 0), listOf(AxisSizeWrite("row", row, 30.0))) }
            assertFailsWith<SheetRevisionConflict> { writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 1), listOf(AxisSizeWrite("row", row, 30.0))) }
            assertFailsWith<WorkbookApplicationException> { writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList()) }
        } }
    }

    @Test
    fun `store validates z order writes before a transaction`() = withSqliteStore { store ->
        val first = testDocument(TEST_SHEET_1, "Inputs"); store.saveWorkbook(testWorkbookOf(first))
        assertFailsWith<IllegalArgumentException> { store.updateSheetZOrder(emptyList()) }
        assertFailsWith<IllegalArgumentException> { store.updateSheetZOrder(listOf(SheetZOrderWrite(ExpectedSheetRevision(TEST_SHEET_1, 0), 2), SheetZOrderWrite(ExpectedSheetRevision(TEST_SHEET_1, 0), 3))) }
    }
}
