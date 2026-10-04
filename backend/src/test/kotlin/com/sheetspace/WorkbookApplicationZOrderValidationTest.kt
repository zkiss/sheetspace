package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookApplicationZOrderValidationTest {
    @Test
    fun `z order requires an update without mutation`() = fixture().assertRejected(WorkbookApplicationError.SHEET_Z_ORDER_UPDATE_REQUIRED, emptyList())

    @Test
    fun `z order rejects duplicate sheets without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(WorkbookApplicationError.DUPLICATE_SHEET_Z_ORDER_UPDATE, listOf(SheetZOrderUpdate(fixture.sheet.id.value, 0, 2), SheetZOrderUpdate(fixture.sheet.id.value, 0, 3)))
    }

    @Test
    fun `z order rejects a missing sheet without mutation`() = fixture().assertRejected(WorkbookApplicationError.SHEET_NOT_FOUND, listOf(SheetZOrderUpdate(TEST_SHEET_2, 0, 2)))

    private fun fixture(): ZOrderFixture {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        return ZOrderFixture(application, application.createSheet(CreateSheetCommand("Inputs")))
    }

    private data class ZOrderFixture(val application: WorkbookApplication, val sheet: SheetDocument) {
        fun assertRejected(expected: WorkbookApplicationError, updates: List<SheetZOrderUpdate>) {
            val before = application.loadWorkbookBundle()
            assertEquals(expected, assertFailsWith<WorkbookApplicationException> { application.updateSheetZOrder(updates) }.error)
            assertEquals(before, application.loadWorkbookBundle())
        }
    }
}
