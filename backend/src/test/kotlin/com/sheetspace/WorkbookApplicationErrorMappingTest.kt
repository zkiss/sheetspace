package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookApplicationErrorMappingTest {
    @Test
    fun `application maps command validation boundaries to public errors`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand(name = "Inputs"))
        application.createSheet(CreateSheetCommand(name = "Outputs"))
        val write = sheet.cellWrite("A1", "value")
        assertError(WorkbookApplicationError.SHEET_NAME_REQUIRED) { application.createSheet(CreateSheetCommand(" ")) }
        assertError(WorkbookApplicationError.SHEET_UPDATE_REQUIRED) { application.updateSheet(sheet.id.value, sheet.revision, UpdateSheetCommand()) }
        assertError(WorkbookApplicationError.SHEET_NAME_DUPLICATE) { application.updateSheet(sheet.id.value, sheet.revision, UpdateSheetCommand(name = "Outputs")) }
        assertError(WorkbookApplicationError.SHEET_Z_ORDER_UPDATE_REQUIRED) { application.updateSheetZOrder(emptyList()) }
        assertError(WorkbookApplicationError.DUPLICATE_SHEET_Z_ORDER_UPDATE) { application.updateSheetZOrder(listOf(SheetZOrderUpdate(sheet.id.value, 0, 2), SheetZOrderUpdate(sheet.id.value, 0, 3))) }
        assertError(WorkbookApplicationError.SHEET_NOT_FOUND) { application.updateSheetZOrder(listOf(SheetZOrderUpdate(TEST_SHEET_2, 0, 2))) }
        assertError(WorkbookApplicationError.EMPTY_CELL_PATCH) { application.writeCells(CellPatchCommand(emptyList(), emptyList())) }
        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) { application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision("bad", 0)), listOf(write))) }
        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) { application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(sheet.id.value, -1)), listOf(write))) }
        assertError(WorkbookApplicationError.DUPLICATE_CELL_WRITE) { application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(sheet.id.value, 0)), listOf(write, write))) }
        assertError(WorkbookApplicationError.DUPLICATE_SHEET_REVISION) { application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(sheet.id.value, 0), ExpectedSheetRevision(sheet.id.value, 1)), listOf(write))) }
        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) { application.writeCells(CellPatchCommand(emptyList(), listOf(write))) }
        assertError(WorkbookApplicationError.INVALID_CELL_COORDINATE) { application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(sheet.id.value, 0)), listOf(write.copy(rowId = RowId.generate().value)))) }
        assertError(WorkbookApplicationError.INVALID_SHEET_Z_INDEX) { application.createSheet(CreateSheetCommand("Other", zIndex = 0)) }
        assertError(WorkbookApplicationError.INVALID_SHEET_POSITION) { application.updateSheet(sheet.id.value, 0, UpdateSheetCommand(position = WorkspacePosition(Double.NaN, 1.0))) }
        assertError(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE) { application.updateSheet(sheet.id.value, 0, UpdateSheetCommand(frameSize = SheetFrameSize(Double.POSITIVE_INFINITY, 1.0))) }
        assertError(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE) { application.updateSheet(sheet.id.value, 0, UpdateSheetCommand(visualScale = Double.NaN)) }
    }

    private fun assertError(expected: WorkbookApplicationError, block: () -> Unit) =
        assertEquals(expected, assertFailsWith<WorkbookApplicationException>(block = block).error)
}
