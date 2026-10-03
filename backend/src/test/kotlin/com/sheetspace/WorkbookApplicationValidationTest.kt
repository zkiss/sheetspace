package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.header
import io.ktor.http.HttpStatusCode

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
        assertEquals(first, application.loadSheet(first.id.value))
    }

    @Test
    fun `application rejects remaining frame name and z order boundaries`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val first = application.createSheet(CreateSheetCommand("First"))
        val second = application.createSheet(CreateSheetCommand("Second"))

        assertError(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE) {
            application.createSheet(CreateSheetCommand("Scale", visualScale = Double.POSITIVE_INFINITY))
        }
        assertError(WorkbookApplicationError.INVALID_SHEET_Z_INDEX) {
            application.createSheet(CreateSheetCommand("Layer", zIndex = 0))
        }
        assertError(WorkbookApplicationError.SHEET_NAME_DUPLICATE) {
            application.updateSheet(second.id.value, second.revision, UpdateSheetCommand(name = "First"))
        }
        assertError(WorkbookApplicationError.SHEET_Z_ORDER_UPDATE_REQUIRED) { application.updateSheetZOrder(emptyList()) }
        assertError(WorkbookApplicationError.DUPLICATE_SHEET_Z_ORDER_UPDATE) {
            application.updateSheetZOrder(listOf(
                SheetZOrderUpdate(first.id.value, first.revision, 1),
                SheetZOrderUpdate(first.id.value, first.revision, 2),
            ))
        }
        assertError(WorkbookApplicationError.SHEET_NOT_FOUND) { application.deleteSheet("missing", 0) }
    }

    private fun assertError(expected: WorkbookApplicationError, block: () -> Unit) {
        assertEquals(expected, assertFailsWith<WorkbookApplicationException>(block = block).error)
    }
}
