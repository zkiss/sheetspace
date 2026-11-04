package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import java.sql.DriverManager
import java.sql.SQLException

class AxisOrderTest {
    @Test
    fun `sqlite reorders both axes and inverse moves without changing identity content`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Inputs", tabular = TabularContent(cells = mapOf("A1" to "=B2", "B2" to "value")))
        val row = initial.tabularContent.rows.first().value
        val column = initial.tabularContent.columns.first().value
        val sheet = initial.copy(
            columnNames = mapOf(column to "Revenue"),
            presentation = SheetPresentation(rowHeights = mapOf(row to 42.0), columnWidths = mapOf(column to 100.0),
                formatOverrides = SheetFormatOverrides(rows = mapOf(row to CellFormat(fontWeight = "bold")))),
        )
        store.saveWorkbook(testWorkbookOf(sheet))
        val app = DefaultWorkbookApplication(store)
        val rows = sheet.tabularContent.rows.map(RowId::value)
        val columns = sheet.tabularContent.columns.map(ColumnId::value)
        val first = app.reorderAxis(TEST_SHEET_1, 0, "row", rows.reversed())
        val second = app.reorderAxis(TEST_SHEET_1, first.revision, "column", columns.reversed())
        assertEquals(rows.reversed(), second.tabularContent.rows.map(RowId::value))
        assertEquals(columns.reversed(), second.tabularContent.columns.map(ColumnId::value))
        assertEquals(sheet.tabularContent.cellContents, second.tabularContent.cellContents)
        assertEquals(sheet.presentation, second.presentation)
        assertEquals(sheet.columnNames, second.columnNames)
        val third = app.reorderAxis(TEST_SHEET_1, second.revision, "row", rows)
        val fourth = app.reorderAxis(TEST_SHEET_1, third.revision, "column", columns)
        assertEquals(sheet.tabularContent, fourth.tabularContent)
        assertEquals(fourth, store.loadSheet(sheet.id))
        assertEquals(fourth, app.reorderAxis(TEST_SHEET_1, fourth.revision, "column", columns))
        assertRejectedWithoutPersisting<SheetRevisionConflict>(store) { app.reorderAxis(TEST_SHEET_1, 0, "row", rows) }
    }

    @Test
    fun `sqlite rolls back revision and order when an order write fails`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            connection.createStatement().use { it.executeUpdate("CREATE TRIGGER fail_reorder BEFORE UPDATE ON sheet_rows BEGIN SELECT RAISE(ABORT, 'rejected'); END") }
            assertRejectedWithoutPersisting<SQLException>(store) {
                DefaultWorkbookApplication(store).reorderAxis(TEST_SHEET_1, 0, "row", sheet.tabularContent.rows.map(RowId::value).reversed())
            }
        }
    }

    @Test
    fun `invalid identity permutations and axes do not mutate the workbook`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val app = DefaultWorkbookApplication(store)
        val rows = sheet.tabularContent.rows.map(RowId::value)
        listOf(rows.drop(1), rows.dropLast(1) + rows.first(), rows.dropLast(1) + "bad", rows + rows.first()).forEach { order ->
            val error = assertRejectedWithoutPersisting<WorkbookApplicationException>(store) { app.reorderAxis(TEST_SHEET_1, 0, "row", order) }
            assertEquals(WorkbookApplicationError.INVALID_AXIS_ORDER, error.error)
        }
        val error = assertRejectedWithoutPersisting<WorkbookApplicationException>(store) { app.reorderAxis(TEST_SHEET_1, 0, "other", rows) }
        assertEquals(WorkbookApplicationError.INVALID_AXIS_ORDER, error.error)
        val missing = assertRejectedWithoutPersisting<WorkbookApplicationException>(store) { app.reorderAxis(TEST_SHEET_2, 0, "row", rows) }
        assertEquals(WorkbookApplicationError.SHEET_NOT_FOUND, missing.error)
    }
}
