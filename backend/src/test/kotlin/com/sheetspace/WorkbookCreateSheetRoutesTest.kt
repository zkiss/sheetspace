package com.sheetspace

import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals

class WorkbookCreateSheetRoutesTest {
    @Test
    fun `create route maps malformed JSON to invalid request without mutating the bundle`() = testWorkbookApplication { application ->
        val baseline = application.loadWorkbookBundle()
        val malformed = client.post("/api/sheets") { jsonBody("{") }
        assertEquals(HttpStatusCode.BadRequest, malformed.status)
        assertEquals(ErrorResponse("invalid-request"), malformed.decodeBody())
        assertEquals(baseline, application.loadWorkbookBundle())
    }

    @Test
    fun `create route maps wrong typed position to invalid request without mutating the bundle`() = testWorkbookApplication { application ->
        val baseline = application.loadWorkbookBundle()
        val invalid = client.post("/api/sheets") { jsonBody("""{"name":"Inputs","position":{"x":"bad","y":0}}""") }
        assertEquals(HttpStatusCode.BadRequest, invalid.status)
        assertEquals(ErrorResponse("invalid-request"), invalid.decodeBody())
        assertEquals(baseline, application.loadWorkbookBundle())
    }

    @Test
    fun `create route maps numeric overflow position to invalid sheet position without mutating the bundle`() = testWorkbookApplication { application ->
        val baseline = application.loadWorkbookBundle()
        val infinite = client.post("/api/sheets") { jsonBody("""{"name":"Inputs","position":{"x":1e999,"y":0}}""") }
        assertEquals(HttpStatusCode.BadRequest, infinite.status)
        assertEquals(ErrorResponse("invalid-sheet-position"), infinite.decodeBody())
        assertEquals(baseline, application.loadWorkbookBundle())
    }
}
