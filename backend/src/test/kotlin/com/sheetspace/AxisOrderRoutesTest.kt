package com.sheetspace

import io.ktor.client.request.header
import io.ktor.client.request.put
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals

class AxisOrderRoutesTest {
    @Test
    fun `route returns authoritative order and maps invalid and stale requests`() = testWorkbookApplication { app ->
        val sheet = client.createSheet()
        val rows = sheet.content.rows.reversed()
        val body = """{"axis":"row","order":[${rows.joinToString(",") { "\"$it\"" }}]}"""
        val response = client.put("/api/sheets/${sheet.id}/axis-order") {
            header("If-Match", "0")
            jsonBody(body)
        }
        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(rows, response.decodeBody<SheetDocumentResponse>().content.rows)
        val before = app.loadWorkbookBundle()
        val stale = client.put("/api/sheets/${sheet.id}/axis-order") { header("If-Match", "0"); jsonBody(body) }
        assertEquals(HttpStatusCode.Conflict, stale.status)
        assertEquals(ErrorResponse("sheet-revision-conflict"), stale.decodeBody())
        val invalid = client.put("/api/sheets/${sheet.id}/axis-order") { header("If-Match", "1"); jsonBody("""{"axis":"other","order":[]}""") }
        assertEquals(HttpStatusCode.BadRequest, invalid.status)
        assertEquals(ErrorResponse("invalid-axis-order"), invalid.decodeBody())
        val malformed = client.put("/api/sheets/${sheet.id}/axis-order") { header("If-Match", "1"); jsonBody("{}") }
        assertEquals(ErrorResponse("invalid-request"), malformed.decodeBody())
        assertEquals(before, app.loadWorkbookBundle())
    }

    @Test
    fun `model bound columns are rejected while rows are reorderable`() = testWorkbookApplication { app ->
        val sheet = client.createSheet()
        val modelId = "30000000-0000-0000-0000-000000000001"
        app.saveDataModel(DataModel(modelId, "Model", emptyList()))
        app.updateSheetModel(sheet.id, UpdateSheetModelCommand(modelId))
        val bound = app.loadSheet(sheet.id)
        val before = app.loadWorkbookBundle()
        val columns = bound.tabularContent.columns.map(ColumnId::value)
        val error = kotlin.test.assertFailsWith<WorkbookApplicationException> { app.reorderAxis(sheet.id, bound.revision, "column", columns.reversed()) }
        assertEquals(WorkbookApplicationError.BOUND_SHEET_STRUCTURE, error.error)
        assertEquals(before, app.loadWorkbookBundle())
        val rows = bound.tabularContent.rows.map(RowId::value).reversed()
        assertEquals(rows, app.reorderAxis(sheet.id, bound.revision, "row", rows).tabularContent.rows.map(RowId::value))
    }
}
