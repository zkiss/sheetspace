package com.sheetspace

import io.ktor.client.request.header
import io.ktor.client.request.put
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals

class SortingWriteRoutesTest {
    @Test
    fun `sorting route saves atomic state and rejects invalid and stale requests`() = testWorkbookApplication { app ->
        val sheet = client.createSheet()
        val rows = sheet.content.rows.reversed()
        val column = sheet.content.columns.first()
        val body = """{"sorting":[{"columnId":"$column","direction":"ascending"}],"order":[${rows.joinToString(",") { "\"$it\"" }}]}"""
        val response = client.put("/api/sheets/${sheet.id}/sorting") { header("If-Match", "0"); jsonBody(body) }
        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(rows, response.decodeBody<SheetDocumentResponse>().content.rows)
        val before = app.loadWorkbookBundle()
        val stale = client.put("/api/sheets/${sheet.id}/sorting") { header("If-Match", "0"); jsonBody(body) }
        assertEquals(HttpStatusCode.Conflict, stale.status)
        val invalid = client.put("/api/sheets/${sheet.id}/sorting") { header("If-Match", "1"); jsonBody("""{"sorting":[{"columnId":"bad","direction":"ascending"}],"order":[]}""") }
        assertEquals(HttpStatusCode.BadRequest, invalid.status)
        assertEquals(ErrorResponse("invalid-sorting"), invalid.decodeBody())
        assertEquals(before, app.loadWorkbookBundle())
    }
}
