package com.sheetspace

import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals

class WorkbookErrorMappingRoutesTest {
    @Test
    fun `command validation errors map to stable client codes`() = testWorkbookApplication { application ->
        val first = client.createSheet()
        val second = client.post("/api/sheets") { jsonBody("""{"name":"Second"}""") }.decodeBody<SheetDocumentResponse>()
        fun HttpRequestBuilder.patchCells(body: String) = jsonBody(body)
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
}
