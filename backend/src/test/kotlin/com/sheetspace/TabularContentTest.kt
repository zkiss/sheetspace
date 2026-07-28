package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class TabularContentTest {
    @Test
    fun `cell bounds use tabular dimensions`() {
        val content = TabularContent(columnCount = 2, rowCount = 3)

        assertTrue(content.containsCell("B3"))
        assertFalse(content.containsCell("C3"))
        assertFalse(content.containsCell("A4"))
        assertFalse(content.containsCell("a1"))
    }

    @Test
    fun `cell mutations preserve raw content and clear empty values`() {
        val raw = "= \n SuM ( B1 , B2 )"
        val stored = TabularContent().updateCell("A1", raw)
        val cleared = stored.updateCell("A1", "")

        assertEquals(raw, stored.cells.getValue("A1"))
        assertFalse(cleared.cells.containsKey("A1"))
    }

    @Test
    fun `structure append preserves cells`() {
        val content = TabularContent(cells = mapOf("A1" to "42"))
        val appendedRow = content.appendRow()
        val appendedColumn = content.appendColumn()

        assertEquals(DEFAULT_ROW_COUNT + 1, appendedRow.rowCount)
        assertEquals(content.rows, appendedRow.rows.dropLast(1))
        assertNotEquals(content.rows.last(), appendedRow.rows.last())
        assertEquals(content.cells, appendedRow.cells)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, appendedColumn.columnCount)
        assertEquals(content.columns, appendedColumn.columns.dropLast(1))
        assertNotEquals(content.columns.last(), appendedColumn.columns.last())
        assertEquals(content.cells, appendedColumn.cells)
    }

    @Test
    fun `A1 addresses resolve through stable ordered identities`() {
        val rows = listOf(RowId("row-2"), RowId("row-1"))
        val columns = listOf(ColumnId("column-b"), ColumnId("column-a"))
        val coordinate = CellCoordinate(rowId = rows[1], columnId = columns[0])
        val content = TabularContent(
            rows = rows,
            columns = columns,
            cellContents = mapOf(coordinate to "raw"),
        )

        assertEquals(coordinate, content.coordinateAt("A2"))
        assertEquals("A2", content.addressOf(coordinate))
        assertEquals(mapOf("A2" to "raw"), content.cells)
    }

    @Test
    fun `cell mutation preserves structural identities`() {
        val content = TabularContent()
        val coordinate = content.coordinateAt("B2")!!
        val updated = content.updateCell("B2", "42")

        assertEquals(content.rows, updated.rows)
        assertEquals(content.columns, updated.columns)
        assertEquals("42", updated.cellContents.getValue(coordinate))
    }

    @Test
    fun `stable state rejects duplicate ids and foreign coordinates`() {
        assertFailsWith<IllegalArgumentException> {
            TabularContent(
                rows = listOf(RowId("same"), RowId("same")),
                columns = listOf(ColumnId("column")),
                cellContents = emptyMap(),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            TabularContent(
                rows = listOf(RowId("row")),
                columns = listOf(ColumnId("column")),
                cellContents = mapOf(
                    CellCoordinate(RowId("foreign"), ColumnId("column")) to "42",
                ),
            )
        }
    }
}
