package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AxisSizePolicyTest {
    @Test
    fun `axis size policy rejects foreign duplicate and nonfinite writes`() {
        val sheet = testDocument(TEST_SHEET_1, "Sizes")
        val foreign = testDocument(TEST_SHEET_2, "Foreign")
        val row = sheet.tabularContent.rows.first().value
        val column = sheet.tabularContent.columns.first().value
        val valid = AxisSizeWrite("column", column, 150.0)
        listOf(AxisSizeWrite("row", row, 15.0), AxisSizeWrite("row", row, 1001.0), AxisSizeWrite("column", column, 23.0), AxisSizeWrite("column", column, 2001.0), AxisSizeWrite("row", row, Double.NaN), AxisSizeWrite("row", row, Double.POSITIVE_INFINITY), AxisSizeWrite("row", column, 30.0), AxisSizeWrite("column", row, null), AxisSizeWrite("row", foreign.tabularContent.rows.first().value, null), AxisSizeWrite("row", "missing", 40.0), AxisSizeWrite("cell", row, 40.0)).forEach { invalid ->
            assertFailsWith<WorkbookApplicationException> { validatedPresentationWrites(sheet, listOf(valid, invalid)) }
        }
    }

    @Test
    fun `axis size policy validates type bounds and atomic batches`() {
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        val row = sheet.tabularContent.rows.first().value
        val column = sheet.tabularContent.columns.first().value

        assertTrue(AxisSizePolicy.validSize("row", AxisSizePolicy.MIN_ROW_HEIGHT))
        assertTrue(AxisSizePolicy.validSize("column", AxisSizePolicy.MAX_COLUMN_WIDTH))
        assertEquals(false, AxisSizePolicy.validSize("row", Double.NaN))
        assertEquals(false, AxisSizePolicy.validSize("row", AxisSizePolicy.MIN_ROW_HEIGHT - 1.0))
        assertEquals(false, AxisSizePolicy.validSize("column", AxisSizePolicy.MIN_COLUMN_WIDTH - 1.0))
        assertEquals(false, AxisSizePolicy.validSize("column", Double.POSITIVE_INFINITY))
        assertEquals(false, AxisSizePolicy.validSize("column", Double.NaN))
        assertEquals(false, AxisSizePolicy.validSize("other", 30.0))
        assertFailsWith<WorkbookApplicationException> { validatedPresentationWrites(sheet, emptyList()) }
        assertFailsWith<WorkbookApplicationException> { validatedPresentationWrites(sheet, listOf(AxisSizeWrite("row", row, 1.0))) }
        assertFailsWith<WorkbookApplicationException> { validatedPresentationWrites(sheet, listOf(AxisSizeWrite("column", column, null), AxisSizeWrite("column", column, null))) }
    }
}
