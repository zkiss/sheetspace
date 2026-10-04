package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookApplicationSheetFrameValidationTest {
    @Test fun `sheet creation rejects an invalid layer without mutation`() = fixture().assertRejected(WorkbookApplicationError.INVALID_SHEET_Z_INDEX) { createSheet(CreateSheetCommand("Layer", zIndex = 0)) }
    @Test fun `sheet creation rejects an invalid position without mutation`() = fixture().assertRejected(WorkbookApplicationError.INVALID_SHEET_POSITION) { createSheet(CreateSheetCommand("Invalid", position = WorkspacePosition(Double.NaN, 1.0))) }
    @Test fun `sheet creation rejects an infinite visual scale without mutation`() = fixture().assertRejected(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE) { createSheet(CreateSheetCommand("Invalid", visualScale = Double.POSITIVE_INFINITY)) }
    @Test fun `sheet creation rejects an invalid frame size without mutation`() = fixture().assertRejected(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE) { createSheet(CreateSheetCommand("Invalid", frameSize = SheetFrameSize(0.0, 1.0))) }

    @Test fun `sheet creation preserves an explicit positive layer`() {
        assertEquals(2, DefaultWorkbookApplication(InMemoryWorkbookStore()).createSheet(CreateSheetCommand("Inputs", zIndex = 2)).frame.zIndex)
    }

    @Test fun `sheet update rejects an invalid position without mutation`() = fixture().let { f -> f.assertRejected(WorkbookApplicationError.INVALID_SHEET_POSITION) { updateSheet(f.inputs.id.value, f.inputs.revision, UpdateSheetCommand(position = WorkspacePosition(Double.NaN, 1.0))) } }
    @Test fun `sheet update rejects an infinite frame size without mutation`() = fixture().let { f -> f.assertRejected(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE) { updateSheet(f.inputs.id.value, f.inputs.revision, UpdateSheetCommand(frameSize = SheetFrameSize(Double.POSITIVE_INFINITY, 1.0))) } }
    @Test fun `sheet update rejects a zero width frame without mutation`() = fixture().let { f -> f.assertRejected(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE) { updateSheet(f.inputs.id.value, f.inputs.revision, UpdateSheetCommand(frameSize = SheetFrameSize(0.0, 1.0))) } }
    @Test fun `sheet update rejects an invalid visual scale without mutation`() = fixture().let { f -> f.assertRejected(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE) { updateSheet(f.inputs.id.value, f.inputs.revision, UpdateSheetCommand(visualScale = Double.NaN)) } }
    @Test fun `sheet update rejects a zero visual scale without mutation`() = fixture().let { f -> f.assertRejected(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE) { updateSheet(f.inputs.id.value, f.inputs.revision, UpdateSheetCommand(visualScale = 0.0)) } }

    @Test fun `invalid position wins before scale validation`() = fixture().let { f ->
        f.assertRejected(WorkbookApplicationError.INVALID_SHEET_POSITION) { updateSheet(f.inputs.id.value, f.inputs.revision, UpdateSheetCommand(position = WorkspacePosition(Double.NaN, 1.0), visualScale = Double.NaN)) }
    }

    private fun fixture(): SheetFrameFixture {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val inputs = application.createSheet(CreateSheetCommand("Inputs"))
        application.createSheet(CreateSheetCommand("Outputs"))
        return SheetFrameFixture(application, inputs)
    }

    private data class SheetFrameFixture(val application: WorkbookApplication, val inputs: SheetDocument) {
        fun assertRejected(expected: WorkbookApplicationError, action: WorkbookApplication.() -> Unit) {
            val before = application.loadWorkbookBundle()
            assertEquals(expected, assertFailsWith<WorkbookApplicationException> { application.action() }.error)
            assertEquals(before, application.loadWorkbookBundle())
        }
    }
}
