package com.sheetspace

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals

class PresentationMutationRoutesTest {
    @Test
    fun `fresh reads expose empty presentation and sizing and removal use revision contract`() = testWorkbookApplication { _ ->
        val initial = client.createSheet()
        assertEquals(SheetPresentationResponse(emptyMap(), emptyMap()), initial.presentation)
        val row = initial.content.rows[0]
        val column = initial.content.columns[0]
        val response = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "0")
            jsonBody("""{"writes":[{"axis":"row","axisId":"$row","size":40},{"axis":"column","axisId":"$column","size":120}]}""")
        }
        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(SheetRevisionResponse(initial.id, 1), response.decodeBody())
        val loaded = client.get("/api/sheets/${initial.id}").decodeBody<SheetDocumentResponse>()
        assertEquals(SheetPresentationResponse(mapOf(row to 40.0), mapOf(column to 120.0)), loaded.presentation)
        assertEquals(initial.content, loaded.content)
        assertEquals(initial.frame, loaded.frame)
        val stale = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "0")
            jsonBody("""{"writes":[{"axis":"row","axisId":"$row","size":null}]}""")
        }
        assertEquals(HttpStatusCode.Conflict, stale.status)
        assertEquals(ErrorResponse("sheet-revision-conflict"), stale.decodeBody())
        val reset = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "1")
            jsonBody("""{"writes":[{"axis":"row","axisId":"$row","size":null}]}""")
        }
        assertEquals(HttpStatusCode.OK, reset.status)
        val reopened = client.get("/api/workbook/bundle").decodeBody<WorkbookBundleResponse>().documents.single()
        assertEquals(2, reopened.revision)
        assertEquals(SheetPresentationResponse(emptyMap(), mapOf(column to 120.0)), reopened.presentation)
    }

    @Test
    fun `malformed and invalid targets reject whole write and missing revisions use existing errors`() = testWorkbookApplication { _ ->
        val initial = client.createSheet()
        val row = initial.content.rows[0]
        val valid = """{"axis":"row","axisId":"$row","size":40}"""
        val invalidBodies = listOf(
            """{"writes":[]}""", """{"writes":[$valid,$valid]}""",
            """{"writes":[$valid,{"axis":"column","axisId":"$row","size":100}]}""",
            """{"writes":[$valid,{"axis":"row","axisId":"missing","size":null}]}""",
            """{"writes":[$valid,{"axis":"row","axisId":"$row","size":15}]}""",
            """{"writes":[$valid,{"axis":"row","axisId":"$row","size":NaN}]}""",
            """{"writes":[{"axis":"row","axisId":"$row"}]}""",
            """{"writes":[{"axis":"row","size":40}]}""", """{"writes":[null]}""",
        )
        invalidBodies.forEach { body ->
            val response = client.patch("/api/sheets/${initial.id}/presentation") { header("If-Match", "0"); jsonBody(body) }
            assertEquals(HttpStatusCode.BadRequest, response.status, response.bodyAsText())
            assertEquals(initial, client.get("/api/sheets/${initial.id}").decodeBody())
        }
        val noRevision = client.patch("/api/sheets/${initial.id}/presentation") { jsonBody("""{"writes":[$valid]}""") }
        assertEquals(ErrorResponse("sheet-revision-required"), noRevision.decodeBody())
        val badRevision = client.patch("/api/sheets/${initial.id}/presentation") { header("If-Match", "wrong"); jsonBody("""{"writes":[$valid]}""") }
        assertEquals(ErrorResponse("invalid-sheet-revision"), badRevision.decodeBody())
        val missing = client.patch("/api/sheets/missing/presentation") { header("If-Match", "0"); jsonBody("""{"writes":[$valid]}""") }
        assertEquals(HttpStatusCode.NotFound, missing.status)
    }
}
