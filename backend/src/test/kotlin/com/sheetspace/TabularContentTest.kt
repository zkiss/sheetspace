package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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

        assertEquals(DEFAULT_ROW_COUNT + 1, content.appendRow().rowCount)
        assertEquals(content.cells, content.appendRow().cells)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, content.appendColumn().columnCount)
        assertEquals(content.cells, content.appendColumn().cells)
    }
}
