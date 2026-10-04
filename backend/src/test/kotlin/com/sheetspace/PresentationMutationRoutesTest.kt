package com.sheetspace

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals

class PresentationMutationRoutesTest {
    @Test
    fun `format overrides round trip at every scope and explicit general survives`() = testWorkbookApplication { _ ->
        val initial = client.createSheet()
        val row = initial.content.rows[0]
        val column = initial.content.columns[0]
        val cell = "$row\u0000$column"
        val response = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "0")
            jsonBody("""{"formatWrites":[{"scope":"row","targetId":"$row","numberFormat":{"kind":"percent","precision":3}},{"scope":"column","targetId":"$column","numberFormat":{"kind":"number","precision":2}},{"scope":"cell","targetId":"$cell","numberFormat":{"kind":"general"}}]}""")
        }
        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(SheetRevisionResponse(initial.id, 1), response.decodeBody())
        val expected = SheetFormatOverrides(
            rows = mapOf(row to CellFormat(NumberFormat("percent", 3))),
            columns = mapOf(column to CellFormat(NumberFormat("number", 2))),
            cells = mapOf(cell to CellFormat(NumberFormat("general"))),
        )
        assertEquals(expected, client.get("/api/sheets/${initial.id}").decodeBody<SheetDocumentResponse>().presentation.formatOverrides)
        val removed = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "1")
            jsonBody("""{"formatWrites":[{"scope":"row","targetId":"$row","numberFormat":null}]}""")
        }
        assertEquals(SheetRevisionResponse(initial.id, 2), removed.decodeBody())
        assertEquals(expected.copy(rows = emptyMap()), client.get("/api/workbook/bundle").decodeBody<WorkbookBundleResponse>().documents.single().presentation.formatOverrides)
    }

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
    fun `presentation route maps malformed requests and revision errors`() = testWorkbookApplication { _ ->
        val initial = client.createSheet()
        val row = initial.content.rows[0]
        val valid = """{"axis":"row","axisId":"$row","size":40}"""
        val malformed = client.patch("/api/sheets/${initial.id}/presentation") { header("If-Match", "0"); jsonBody("{") }
        assertEquals(HttpStatusCode.BadRequest, malformed.status)
        val noRevision = client.patch("/api/sheets/${initial.id}/presentation") { jsonBody("""{"writes":[$valid]}""") }
        assertEquals(ErrorResponse("sheet-revision-required"), noRevision.decodeBody())
        val badRevision = client.patch("/api/sheets/${initial.id}/presentation") { header("If-Match", "wrong"); jsonBody("""{"writes":[$valid]}""") }
        assertEquals(ErrorResponse("invalid-sheet-revision"), badRevision.decodeBody())
        val missing = client.patch("/api/sheets/missing/presentation") { header("If-Match", "0"); jsonBody("""{"writes":[$valid]}""") }
        assertEquals(HttpStatusCode.NotFound, missing.status)
    }

    @Test
    fun `presentation route rejects empty and duplicate appearance patches`() = testWorkbookApplication { _ ->
        val initial = client.createSheet()
        val row = initial.content.rows.first()

        val empty = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "0")
            jsonBody("{}")
        }
        val duplicateProperty = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "0")
            jsonBody(
                """{"formatWrites":[{"scope":"row","targetId":"$row","properties":{"fontWeight":"bold","fontWeight":"normal"}}]}""",
            )
        }

        assertEquals(HttpStatusCode.BadRequest, empty.status)
        assertEquals(ErrorResponse("invalid-sheet-presentation"), empty.decodeBody())
        assertEquals(HttpStatusCode.BadRequest, duplicateProperty.status)
        assertEquals(ErrorResponse("invalid-request"), duplicateProperty.decodeBody())
    }

    @Test
    fun `presentation route rejects a write without size without mutation`() = testWorkbookApplication { _ ->
        val initial = client.createSheet()
        val before = client.loadWorkbook()

        val response = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "0")
            jsonBody("""{"writes":[{"axis":"row","axisId":"${initial.content.rows.first()}"}]}""")
        }

        assertInvalidRequestWithoutMutation(client, response, before)
    }

    @Test
    fun `presentation route rejects a write without axis ID without mutation`() = testWorkbookApplication { _ ->
        val initial = client.createSheet()
        val before = client.loadWorkbook()

        val response = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "0")
            jsonBody("""{"writes":[{"axis":"row","size":40}]}""")
        }

        assertInvalidRequestWithoutMutation(client, response, before)
    }

    @Test
    fun `presentation route rejects a null write without mutation`() = testWorkbookApplication { _ ->
        val initial = client.createSheet()
        val before = client.loadWorkbook()

        val response = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "0")
            jsonBody("""{"writes":[null]}""")
        }

        assertInvalidRequestWithoutMutation(client, response, before)
    }

    @Test
    fun `presentation route rejects a non-finite size token without mutation`() = testWorkbookApplication { _ ->
        val initial = client.createSheet()
        val row = initial.content.rows.first()
        val column = initial.content.columns.first()
        val before = client.loadWorkbook()

        val response = client.patch("/api/sheets/${initial.id}/presentation") {
            header("If-Match", "0")
            jsonBody("""{"writes":[{"axis":"column","axisId":"$column","size":120},{"axis":"row","axisId":"$row","size":NaN}]}""")
        }

        assertInvalidRequestWithoutMutation(client, response, before)
    }

    private suspend fun assertInvalidRequestWithoutMutation(
        client: HttpClient,
        response: io.ktor.client.statement.HttpResponse,
        before: TestWorkbook,
    ) {
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals(ErrorResponse("invalid-request"), response.decodeBody())
        assertEquals(before, client.loadWorkbook())
    }
}
