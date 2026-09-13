package com.sheetspace

import java.nio.file.Files
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteWorkbookStorePresentationTest {
    @Test
    fun `sizes and targeted removal survive database reopen with cells and frame intact`() {
        val path = Files.createTempFile("sheetspace-presentation", ".db")
        val initial = testDocument(TEST_SHEET_1, "Sizes", tabular = TabularContent(cells = mapOf("A1" to "=B1", "B1" to "3")))
        val row = initial.tabularContent.rows[0].value
        val column = initial.tabularContent.columns[0].value
        try {
            SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(testWorkbookOf(initial))
                assertEquals(SheetPresentation(), store.loadSheet(initial.id)!!.presentation)
                val sized = store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(AxisSizeWrite("row", row, 40.0), AxisSizeWrite("column", column, 140.0)))
                assertEquals(1, sized.revision)
                assertEquals(initial.frame, sized.frame)
                assertEquals(initial.content, sized.content)
            }
            SqliteWorkbookStore(path).use { store ->
                assertEquals(SheetPresentation(mapOf(row to 40.0), mapOf(column to 140.0)), store.loadSheet(initial.id)!!.presentation)
                val reset = store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 1), listOf(AxisSizeWrite("row", row, null)))
                assertEquals(2, reset.revision)
                assertEquals(SheetPresentation(columnWidths = mapOf(column to 140.0)), reset.presentation)
            }
            SqliteWorkbookStore(path).use { store ->
                val reopened = store.loadSheet(initial.id)!!
                assertEquals(SheetPresentation(columnWidths = mapOf(column to 140.0)), reopened.presentation)
                assertEquals(initial.content, reopened.content)
                assertEquals(initial.frame, reopened.frame)
                assertEquals(0, store.loadManifest().revision)
            }
        } finally { Files.deleteIfExists(path) }
    }

    @Test
    fun `invalid batches and stale revision never partially mutate presentation`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Sizes")
        val foreign = testDocument(TEST_SHEET_2, "Foreign")
        store.saveWorkbook(testWorkbookOf(initial, foreign))
        val row = initial.tabularContent.rows[0].value
        val column = initial.tabularContent.columns[0].value
        val valid = AxisSizeWrite("column", column, 150.0)
        val invalid = listOf(
            AxisSizeWrite("row", row, 15.0), AxisSizeWrite("row", row, 1001.0),
            AxisSizeWrite("column", column, 23.0), AxisSizeWrite("column", column, 2001.0),
            AxisSizeWrite("row", row, Double.NaN), AxisSizeWrite("row", row, Double.POSITIVE_INFINITY),
            AxisSizeWrite("row", column, 30.0), AxisSizeWrite("column", row, null),
            AxisSizeWrite("row", foreign.tabularContent.rows[0].value, null),
            AxisSizeWrite("row", "missing", 40.0), AxisSizeWrite("cell", row, 40.0),
        )
        invalid.forEach { write ->
            assertFailsWith<WorkbookApplicationException> {
                store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(valid, write))
            }
            assertEquals(initial, store.loadSheet(initial.id))
        }
        assertFailsWith<WorkbookApplicationException> { store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList()) }
        assertFailsWith<WorkbookApplicationException> { store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(valid, valid.copy(size = null))) }
        store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(valid))
        val before = store.loadSheet(initial.id)
        assertFailsWith<SheetRevisionConflict> { store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(AxisSizeWrite("row", row, 40.0), valid.copy(size = null))) }
        assertEquals(before, store.loadSheet(initial.id))
        assertEquals(foreign, store.loadSheet(foreign.id))
    }

    @Test
    fun `presentation writes touch only their owning records and share revision with cells frame and structure`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Sizes", tabular = TabularContent(cells = mapOf("A1" to "3")))
        store.saveWorkbook(testWorkbookOf(initial))
        DriverManager.getConnection(store.jdbcUrl).use { conn ->
            conn.createStatement().use { statement ->
                listOf("frame_state", "sheet_rows", "sheet_columns", "cells", "workbook_sheets").forEach { table ->
                    listOf("INSERT", "UPDATE", "DELETE").forEach { operation ->
                        statement.execute("CREATE TRIGGER forbid_${table}_${operation.lowercase()} BEFORE $operation ON $table BEGIN SELECT RAISE(ABORT, 'unowned write'); END")
                    }
                }
            }
            val sized = store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(AxisSizeWrite("row", initial.tabularContent.rows[0].value, 16.0), AxisSizeWrite("column", initial.tabularContent.columns[0].value, 2000.0)))
            assertEquals(1, sized.revision)
            conn.createStatement().use { statement ->
                listOf("frame_state", "sheet_rows", "sheet_columns", "cells", "workbook_sheets").forEach { table ->
                    listOf("INSERT", "UPDATE", "DELETE").forEach { operation -> statement.execute("DROP TRIGGER forbid_${table}_${operation.lowercase()}") }
                }
            }
        }
        val app = DefaultWorkbookApplication(store)
        app.updateCell(TEST_SHEET_1, "A1", "5", 1)
        app.updateSheet(TEST_SHEET_1, 2, UpdateSheetCommand(position = WorkspacePosition(20.0, 30.0)))
        app.appendRow(TEST_SHEET_1, 3)
        app.updateSheet(TEST_SHEET_1, 4, UpdateSheetCommand(name = "Renamed"))
        app.updateSheetZOrder(listOf(SheetZOrderUpdate(TEST_SHEET_1, 5, 2)))
        val reset = app.writePresentation(TEST_SHEET_1, 6, listOf(AxisSizeWrite("row", initial.tabularContent.rows[0].value, null)))
        assertEquals(7, reset.revision)
        assertEquals("5", reset.tabularContent.cells["A1"])
        assertEquals("Renamed", reset.name)
        assertEquals(21, reset.tabularContent.rowCount)
        assertEquals(SheetPresentation(columnWidths = mapOf(initial.tabularContent.columns[0].value to 2000.0)), reset.presentation)
    }

    @Test
    fun `aggregate creation and replacement retain sparse presentation`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Sizes")
        val row = initial.tabularContent.rows[0].value
        val sized = initial.copy(presentation = SheetPresentation(rowHeights = mapOf(row to 1000.0)))
        store.saveWorkbook(testWorkbookOf(sized))
        assertEquals(sized, store.loadSheet(initial.id))
        store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook -> workbook.replaceSheet(sized.copy(presentation = SheetPresentation())) }
        assertEquals(SheetPresentation(), store.loadSheet(initial.id)!!.presentation)
    }
}
