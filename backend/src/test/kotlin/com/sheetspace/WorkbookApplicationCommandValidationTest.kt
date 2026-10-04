package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFailsWith

class WorkbookApplicationCommandValidationTest {
    @Test
    fun `application validates cell patch UUID components`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand("Inputs", zIndex = 2))
        val valid = sheet.cellWrite("A1", "value")
        fun invalid(write: SheetCellWrite) = assertFailsWith<WorkbookApplicationException> {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(sheet.id.value, 0)), listOf(write)))
        }
        invalid(valid.copy(sheetId = "bad"))
        invalid(valid.copy(rowId = "bad"))
        invalid(valid.copy(columnId = "bad"))
    }
}
