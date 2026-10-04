package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AxisSizePolicyTest {
    @Test
    fun `row height accepts its lower bound`() = assertTrue(AxisSizePolicy.validSize("row", AxisSizePolicy.MIN_ROW_HEIGHT))
    @Test
    fun `column width accepts its upper bound`() = assertTrue(AxisSizePolicy.validSize("column", AxisSizePolicy.MAX_COLUMN_WIDTH))
    @Test
    fun `row height rejects NaN`() = assertEquals(false, AxisSizePolicy.validSize("row", Double.NaN))
    @Test
    fun `row height rejects values below its lower bound`() = assertEquals(false, AxisSizePolicy.validSize("row", AxisSizePolicy.MIN_ROW_HEIGHT - 1.0))
    @Test
    fun `column width rejects values below its lower bound`() = assertEquals(false, AxisSizePolicy.validSize("column", AxisSizePolicy.MIN_COLUMN_WIDTH - 1.0))
    @Test
    fun `column width rejects infinity`() = assertEquals(false, AxisSizePolicy.validSize("column", Double.POSITIVE_INFINITY))
    @Test
    fun `unknown axis rejects sizes`() = assertEquals(false, AxisSizePolicy.validSize("other", 30.0))

    @Test
    fun `presentation rejects an empty size patch`() = assertRejected(emptyList())
    @Test
    fun `presentation rejects a row below minimum height`() = fixture().let { assertRejected(it, listOf(AxisSizeWrite("row", it.row, 15.0))) }
    @Test
    fun `presentation rejects duplicate axis targets`() = fixture().let { assertRejected(it, listOf(AxisSizeWrite("column", it.column, null), AxisSizeWrite("column", it.column, null))) }
    @Test
    fun `presentation rejects a row with a column identity`() = fixture().let { assertRejected(it, listOf(AxisSizeWrite("row", it.column, 30.0))) }
    @Test
    fun `presentation rejects a missing row`() = fixture().let { assertRejected(it, listOf(AxisSizeWrite("row", "missing", 40.0))) }
    @Test
    fun `presentation rejects a non-axis scope`() = fixture().let { assertRejected(it, listOf(AxisSizeWrite("cell", it.row, 40.0))) }
    @Test
    fun `presentation rejects a row above maximum height`() = fixture().let { assertRejected(it, listOf(AxisSizeWrite("row", it.row, 1001.0))) }
    @Test
    fun `presentation rejects a narrow column`() = fixture().let { assertRejected(it, listOf(AxisSizeWrite("column", it.column, 23.0))) }
    @Test
    fun `presentation rejects a wide column`() = fixture().let { assertRejected(it, listOf(AxisSizeWrite("column", it.column, 2001.0))) }
    @Test
    fun `presentation rejects a nonfinite row size`() = fixture().let { assertRejected(it, listOf(AxisSizeWrite("row", it.row, Double.POSITIVE_INFINITY))) }
    @Test
    fun `presentation rejects a foreign row`() = fixture().let { assertRejected(it, listOf(AxisSizeWrite("row", testDocument(TEST_SHEET_2, "Foreign").tabularContent.rows.first().value, null))) }

    private fun assertRejected(writes: List<AxisSizeWrite>): Unit = assertRejected(fixture(), writes)
    private fun assertRejected(fixture: AxisFixture, writes: List<AxisSizeWrite>): Unit { assertFailsWith<WorkbookApplicationException> {
        validatedPresentationWrites(fixture.sheet, writes)
    } }

    private fun fixture(): AxisFixture {
        val sheet = testDocument(TEST_SHEET_1, "Sizes")
        return AxisFixture(sheet, sheet.tabularContent.rows.first().value, sheet.tabularContent.columns.first().value)
    }
    private data class AxisFixture(val sheet: SheetDocument, val row: String, val column: String)
}
