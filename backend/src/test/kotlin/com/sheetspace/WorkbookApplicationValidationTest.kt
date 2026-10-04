package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookApplicationValidationTest {
    @Test
    fun `application rejects every malformed cell patch before writing`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val first = application.createSheet(CreateSheetCommand("First"))
        val second = application.createSheet(CreateSheetCommand("Second"))
        val valid = first.cellWrite("A1", "one")

        assertError(WorkbookApplicationError.EMPTY_CELL_PATCH) {
            application.writeCells(CellPatchCommand(emptyList(), emptyList()))
        }
        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(first.id.value, 0)), listOf(valid.copy(rowId = "bad"))))
        }
        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(first.id.value, -1)), listOf(valid)))
        }
        assertError(WorkbookApplicationError.DUPLICATE_CELL_WRITE) {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(first.id.value, 0)), listOf(valid, valid)))
        }
        assertError(WorkbookApplicationError.DUPLICATE_SHEET_REVISION) {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(first.id.value, 0), ExpectedSheetRevision(first.id.value, 0)), listOf(valid)))
        }
        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(second.id.value, 0)), listOf(valid)))
        }
        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            application.writeCells(CellPatchCommand(emptyList(), listOf(valid)))
        }
        assertError(WorkbookApplicationError.INVALID_CELL_COORDINATE) {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(first.id.value, 0)), listOf(valid.copy(rowId = RowId.generate().value))))
        }
        assertEquals(first, application.loadSheet(first.id.value))
    }

    @Test
    fun `application rejects malformed expected sheet revisions without writing`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand("Inputs"))

        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            application.writeCells(
                CellPatchCommand(
                    expectedRevisions = listOf(ExpectedSheetRevision("bad", 0)),
                    cells = listOf(sheet.cellWrite("A1", "value")),
                ),
            )
        }

        assertEquals(sheet, application.loadSheet(sheet.id.value))
    }

    private fun assertError(expected: WorkbookApplicationError, block: () -> Unit) {
        assertEquals(expected, assertFailsWith<WorkbookApplicationException>(block = block).error)
    }
}
