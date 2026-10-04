package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookApplicationSheetValidationTest {
    @Test
    fun `sheet creation rejects a blank name without mutation`() = fixture().assertRejected(WorkbookApplicationError.SHEET_NAME_REQUIRED) { createSheet(CreateSheetCommand(" ")) }

    @Test
    fun `sheet creation rejects a duplicate name without mutation`() = fixture().assertRejected(WorkbookApplicationError.SHEET_NAME_DUPLICATE) { createSheet(CreateSheetCommand("Inputs")) }

    @Test
    fun `sheet update requires a change without mutation`() = fixture().let { fixture -> fixture.assertRejected(WorkbookApplicationError.SHEET_UPDATE_REQUIRED) { updateSheet(fixture.inputs.id.value, fixture.inputs.revision, UpdateSheetCommand()) } }

    @Test
    fun `sheet update rejects a duplicate name without mutation`() = fixture().let { fixture -> fixture.assertRejected(WorkbookApplicationError.SHEET_NAME_DUPLICATE) { updateSheet(fixture.inputs.id.value, fixture.inputs.revision, UpdateSheetCommand(name = "Outputs")) } }

    @Test
    fun `sheet deletion rejects a missing sheet without mutation`() = fixture().assertRejected(WorkbookApplicationError.SHEET_NOT_FOUND) { deleteSheet("missing", 0) }

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
