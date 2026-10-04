package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class WorkbookDomainPolicyTest {
    @Test
    fun `workbook and frame policies reject invalid values`() {
        val first = testDocument(TEST_SHEET_1, "Inputs")
        assertEquals(1, (createSheetDocument("First") as SheetNameResult.Valid).value.frame.zIndex)
        assertEquals(9, (createSheetDocument("Second", listOf(first.copy(frame = FrameState(zIndex = 8))), zIndex = 9) as SheetNameResult.Valid).value.frame.zIndex)
        assertEquals(9, (createSheetDocument("Third", listOf(first.copy(frame = FrameState(zIndex = 8)), first.copy(id = SheetId.generate(), frame = FrameState(zIndex = 3)))) as SheetNameResult.Valid).value.frame.zIndex)
        assertEquals(9, (createSheetDocument("Fourth", listOf(first.copy(frame = FrameState(zIndex = 8)), first.copy(id = SheetId.generate(), frame = FrameState(zIndex = 8)))) as SheetNameResult.Valid).value.frame.zIndex)
        assertFailsWith<IllegalArgumentException> { WorkbookManifest(sheetIds = listOf(first.id, first.id)) }
        assertFailsWith<IllegalArgumentException> { WorkbookState(documents = mapOf(first.id to first)) }
        assertFailsWith<IllegalArgumentException> { WorkbookManifest().remove(first.id) }
        assertFailsWith<IllegalArgumentException> { testWorkbookOf(first).replaceSheet(testDocument(TEST_SHEET_2, "Other")) }
        assertFailsWith<IllegalArgumentException> { byteArrayOf(1).toUuidString() }
        assertTrue(WorkspacePosition(1.0, 2.0).isValid())
        assertEquals(false, WorkspacePosition(Double.NaN, 2.0).isValid())
        assertEquals(false, WorkspacePosition(1.0, Double.NEGATIVE_INFINITY).isValid())
        assertTrue(SheetFrameSize(1.0, 2.0).isValid())
        assertEquals(false, SheetFrameSize(Double.NaN, 2.0).isValid())
        assertEquals(false, SheetFrameSize(1.0, Double.POSITIVE_INFINITY).isValid())
        assertEquals(false, SheetFrameSize(0.0, 2.0).isValid())
    }

    @Test
    fun `axis size policy validates boundaries and atomic write batches`() {
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
        assertFailsWith<WorkbookApplicationException> { validatedPresentationWrites(sheet, listOf(AxisSizeWrite("row", row, 1.0))) }
        assertFailsWith<WorkbookApplicationException> { validatedPresentationWrites(sheet, listOf(AxisSizeWrite("column", column, null), AxisSizeWrite("column", column, null))) }
    }
}
