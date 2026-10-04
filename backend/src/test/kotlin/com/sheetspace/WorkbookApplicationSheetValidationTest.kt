package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookApplicationSheetValidationTest {
    @Test
    fun `sheet creation rejects a blank name without mutation`() = fixture().assertRejected(WorkbookApplicationError.SHEET_NAME_REQUIRED) { createSheet(CreateSheetCommand(" ")) }

    @Test
    fun `sheet update requires a change without mutation`() = fixture().let { fixture -> fixture.assertRejected(WorkbookApplicationError.SHEET_UPDATE_REQUIRED) { updateSheet(fixture.inputs.id.value, fixture.inputs.revision, UpdateSheetCommand()) } }

    @Test
    fun `sheet update rejects a duplicate name without mutation`() = fixture().let { fixture -> fixture.assertRejected(WorkbookApplicationError.SHEET_NAME_DUPLICATE) { updateSheet(fixture.inputs.id.value, fixture.inputs.revision, UpdateSheetCommand(name = "Outputs")) } }

    @Test
    fun `sheet deletion rejects a missing sheet without mutation`() = fixture().assertRejected(WorkbookApplicationError.SHEET_NOT_FOUND) { deleteSheet("missing", 0) }

    @Test
    fun `sheet creation rejects an invalid layer without mutation`() = fixture().assertRejected(WorkbookApplicationError.INVALID_SHEET_Z_INDEX) { createSheet(CreateSheetCommand("Layer", zIndex = 0)) }

    @Test
    fun `sheet update rejects an invalid position without mutation`() = fixture().let { fixture -> fixture.assertRejected(WorkbookApplicationError.INVALID_SHEET_POSITION) { updateSheet(fixture.inputs.id.value, fixture.inputs.revision, UpdateSheetCommand(position = WorkspacePosition(Double.NaN, 1.0))) } }

    @Test
    fun `sheet update rejects an invalid frame size without mutation`() = fixture().let { fixture -> fixture.assertRejected(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE) { updateSheet(fixture.inputs.id.value, fixture.inputs.revision, UpdateSheetCommand(frameSize = SheetFrameSize(Double.POSITIVE_INFINITY, 1.0))) } }

    @Test
    fun `sheet update rejects an invalid visual scale without mutation`() = fixture().let { fixture -> fixture.assertRejected(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE) { updateSheet(fixture.inputs.id.value, fixture.inputs.revision, UpdateSheetCommand(visualScale = Double.NaN)) } }

    @Test
    fun `sheet frame commands reject invalid position size scale and creation layer`() {
        // Command precedence is an intentional multi-rule interaction.
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand("Inputs"))
        assertError(WorkbookApplicationError.INVALID_SHEET_POSITION) { application.updateSheet(sheet.id.value, 0, UpdateSheetCommand(position = WorkspacePosition(Double.NaN, 1.0), visualScale = Double.NaN)) }
    }

    @Test
    fun `sheet creation rejects an invalid frame size without mutation`() = fixture().assertRejected(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE) { createSheet(CreateSheetCommand("Invalid", frameSize = SheetFrameSize(0.0, 1.0))) }

    @Test
    fun `sheet creation preserves an explicit positive layer`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())

        val sheet = application.createSheet(CreateSheetCommand("Inputs", zIndex = 2))

        assertEquals(2, sheet.frame.zIndex)
    }

    private fun assertError(expected: WorkbookApplicationError, block: () -> Unit) =
        assertEquals(expected, assertFailsWith<WorkbookApplicationException>(block = block).error)

    private fun fixture(): SheetFixture {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val inputs = application.createSheet(CreateSheetCommand("Inputs"))
        application.createSheet(CreateSheetCommand("Outputs"))
        return SheetFixture(application, inputs)
    }

    private data class SheetFixture(val application: WorkbookApplication, val inputs: SheetDocument) {
        fun assertRejected(expected: WorkbookApplicationError, action: WorkbookApplication.() -> Unit) {
            val before = application.loadWorkbookBundle()
            assertEquals(expected, assertFailsWith<WorkbookApplicationException> { application.action() }.error)
            assertEquals(before, application.loadWorkbookBundle())
        }
    }
}
