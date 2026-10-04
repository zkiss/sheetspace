package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookApplicationZOrderValidationTest {
    @Test
    fun `z order commands require distinct existing sheets`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand("Inputs"))

        assertError(WorkbookApplicationError.SHEET_Z_ORDER_UPDATE_REQUIRED) { application.updateSheetZOrder(emptyList()) }
        assertError(WorkbookApplicationError.DUPLICATE_SHEET_Z_ORDER_UPDATE) { application.updateSheetZOrder(listOf(SheetZOrderUpdate(sheet.id.value, 0, 2), SheetZOrderUpdate(sheet.id.value, 0, 3))) }
        assertError(WorkbookApplicationError.SHEET_NOT_FOUND) { application.updateSheetZOrder(listOf(SheetZOrderUpdate(TEST_SHEET_2, 0, 2))) }
    }

    private fun assertError(expected: WorkbookApplicationError, block: () -> Unit) =
        assertEquals(expected, assertFailsWith<WorkbookApplicationException>(block = block).error)
}
