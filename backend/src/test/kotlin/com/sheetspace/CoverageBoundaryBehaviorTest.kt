package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.header
import io.ktor.http.HttpStatusCode

/** Exercises public validation boundaries which are deliberately not reached by happy-path route tests. */
class CoverageBoundaryBehaviorTest {
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

    @Test
    fun `tabular value behavior covers resize identity and object contracts`() {
        val content = TabularContent(columnCount = 2, rowCount = 2, cells = mapOf("A1" to "x"))
        val grown = content.copy(columnCount = 3, rowCount = 3, cells = mapOf("C3" to "y"))
        val shrunk = grown.copy(columnCount = 1, rowCount = 1, cells = emptyMap())

        assertEquals("y", grown.cells.getValue("C3"))
        assertEquals(1, shrunk.rowCount)
        assertEquals(1, shrunk.columnCount)
        assertEquals(content, content.copy())
        assertNotEquals(content, grown)
        assertNotEquals(content.hashCode(), grown.hashCode())
        assertTrue(content.toString().contains("TabularContent"))
        assertFailsWith<IllegalArgumentException> { content.copy(columnCount = -1) }
        assertFailsWith<IllegalArgumentException> { content.updateCell("Z99", "x") }
    }

    @Test
    fun `transport value objects retain data class behavior`() {
        val create = CreateSheetRequest("Inputs")
        val update = UpdateSheetRequest(name = "Outputs")
        val zOrder = SheetZOrderUpdateRequest("id", 3, 2)
        val response = SheetRevisionResponse("id", 3)

        assertEquals(create, create.copy())
        assertEquals("Inputs", create.component1())
        assertEquals(update, update.copy())
        assertEquals("Outputs", update.component1())
        assertEquals(zOrder, zOrder.copy())
        assertEquals("id", zOrder.component1())
        assertEquals(response, response.copy())
        assertTrue(response.toString().contains("SheetRevisionResponse"))
    }

    @Test
    fun `http maps all command validation errors to their stable client codes`() = testWorkbookApplication { application ->
        val first = client.createSheet()
        val second = client.post("/api/sheets") { jsonBody("""{"name":"Second"}""") }.decodeBody<SheetDocumentResponse>()
        fun io.ktor.client.request.HttpRequestBuilder.patchCells(body: String) = jsonBody(body)
        val cases = listOf(
            client.post("/api/sheets") { jsonBody("""{"name":"Inputs"}""") } to "sheet-name-duplicate",
            client.post("/api/sheets") { jsonBody("""{"name":"Scale","visualScale":0}""") } to "invalid-sheet-visual-scale",
            client.post("/api/sheets") { jsonBody("""{"name":"Layer","zIndex":0}""") } to "invalid-sheet-z-index",
            client.patch("/api/workbook/sheet-z-order") { jsonBody("""{"updates":[]}""") } to "sheet-z-order-update-required",
            client.patch("/api/workbook/sheet-z-order") { jsonBody("""{"updates":[{"sheetId":"${first.id}","expectedRevision":0,"zIndex":1},{"sheetId":"${first.id}","expectedRevision":0,"zIndex":2}]}""") } to "duplicate-sheet-z-order-update",
            client.patch("/api/cells") { patchCells("""{"expectedRevisions":[],"cells":[]}""") } to "empty-cell-patch",
            client.patch("/api/cells") { patchCells("""{"expectedRevisions":[{"sheetId":"${first.id}","revision":0}],"cells":[{"sheetId":"${first.id}","rowId":"bad","columnId":"bad","raw":"x"}]}""") } to "invalid-cell-patch",
            client.patch("/api/cells") { patchCells("""{"expectedRevisions":[{"sheetId":"${first.id}","revision":0},{"sheetId":"${first.id}","revision":0}],"cells":[{"sheetId":"${first.id}","rowId":"${application.loadSheet(first.id).tabularContent.rows.first().value}","columnId":"${application.loadSheet(first.id).tabularContent.columns.first().value}","raw":"x"}]}""") } to "duplicate-sheet-revision",
            client.patch("/api/sheets/${second.id}") { header("If-Match", "0"); jsonBody("{}") } to "sheet-update-required",
        )
        cases.forEach { (response, code) ->
            assertEquals(HttpStatusCode.BadRequest, response.status)
            assertEquals(ErrorResponse(code), response.decodeBody<ErrorResponse>())
        }
    }

    private fun assertError(expected: WorkbookApplicationError, block: () -> Unit) {
        assertEquals(expected, assertFailsWith<WorkbookApplicationException>(block = block).error)
    }
}
