package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookApplicationSheetValidationTest {
    @Test
    fun `sheet lifecycle validates names required updates and missing deletes`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val inputs = application.createSheet(CreateSheetCommand("Inputs"))
        application.createSheet(CreateSheetCommand("Outputs"))

        assertError(WorkbookApplicationError.SHEET_NAME_REQUIRED) { application.createSheet(CreateSheetCommand(" ")) }
        assertError(WorkbookApplicationError.SHEET_UPDATE_REQUIRED) { application.updateSheet(inputs.id.value, inputs.revision, UpdateSheetCommand()) }
        assertError(WorkbookApplicationError.SHEET_NAME_DUPLICATE) { application.updateSheet(inputs.id.value, inputs.revision, UpdateSheetCommand(name = "Outputs")) }
        assertError(WorkbookApplicationError.SHEET_NOT_FOUND) { application.deleteSheet("missing", 0) }
    }

    @Test
    fun `sheet frame commands reject invalid position size scale and creation layer`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand("Inputs"))

        assertError(WorkbookApplicationError.INVALID_SHEET_Z_INDEX) { application.createSheet(CreateSheetCommand("Layer", zIndex = 0)) }
        assertError(WorkbookApplicationError.INVALID_SHEET_POSITION) { application.updateSheet(sheet.id.value, 0, UpdateSheetCommand(position = WorkspacePosition(Double.NaN, 1.0))) }
        assertError(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE) { application.updateSheet(sheet.id.value, 0, UpdateSheetCommand(frameSize = SheetFrameSize(Double.POSITIVE_INFINITY, 1.0))) }
        assertError(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE) { application.updateSheet(sheet.id.value, 0, UpdateSheetCommand(visualScale = Double.NaN)) }
    }

    @Test
    fun `sheet creation rejects an invalid frame size without mutating the workbook`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val existing = application.createSheet(CreateSheetCommand("Inputs"))

        assertError(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE) {
            application.createSheet(CreateSheetCommand("Invalid", frameSize = SheetFrameSize(0.0, 1.0)))
        }

        assertEquals(listOf(existing.id), application.loadManifest().sheetIds)
    }

    private fun assertError(expected: WorkbookApplicationError, block: () -> Unit) =
        assertEquals(expected, assertFailsWith<WorkbookApplicationException>(block = block).error)
}
