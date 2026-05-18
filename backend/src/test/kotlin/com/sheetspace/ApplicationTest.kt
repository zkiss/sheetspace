package com.sheetspace

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ApplicationTest {
    private val json = Json { ignoreUnknownKeys = false }

    @Test
    fun `workbook endpoint loads empty persisted state`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }

        val response = client.get("/api/workbook")

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(emptyWorkbook(), response.decodeBody<Workbook>())
    }

    @Test
    fun `sheet creation endpoint persists sheet for later workbook loads`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }

        val response = client.post("/api/sheets") {
            jsonBody("""{"id":"sheet-1","name":" Inputs ","position":{"x":24.0,"y":48.0}}""")
        }

        assertEquals(HttpStatusCode.Created, response.status)
        val workbook = client.loadWorkbook()
        assertEquals(
            listOf(Sheet(id = "sheet-1", name = "Inputs", position = WorkspacePosition(24.0, 48.0))),
            workbook.sheets,
        )
    }

    @Test
    fun `cell update endpoint persists raw content without evaluated formula artifacts`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val response = client.put("/api/sheets/sheet-1/cells/A1") {
            revisionHeader(repo, "sheet-1")
            jsonBody("""{"raw":"=SUM(B1:B2)"}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("=SUM(B1:B2)", sheet.cells.getValue("A1").raw)
        assertFalse(sheet.cells.containsKey("A1_display"))
    }

    @Test
    fun `stale sheet revision mutation returns conflict without overwriting newer content`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()
        val initialRevision = client.loadWorkbook().sheets.single().revision

        val firstUpdate = client.put("/api/sheets/sheet-1/cells/A1") {
            header("If-Match", initialRevision.toString())
            jsonBody("""{"raw":"newer value"}""")
        }
        val staleUpdate = client.put("/api/sheets/sheet-1/cells/A1") {
            header("If-Match", initialRevision.toString())
            jsonBody("""{"raw":"stale value"}""")
        }

        assertEquals(HttpStatusCode.OK, firstUpdate.status)
        assertEquals(HttpStatusCode.Conflict, staleUpdate.status)
        assertEquals(ErrorResponse(error = "sheet-revision-conflict"), staleUpdate.decodeBody<ErrorResponse>())
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("newer value", sheet.cells.getValue("A1").raw)
        assertTrue(sheet.revision > initialRevision)
    }

    @Test
    fun `sheet update endpoint persists rename position and frame size`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val response = client.patch("/api/sheets/sheet-1") {
            revisionHeader(repo, "sheet-1")
            jsonBody("""{"name":"Renamed Inputs","position":{"x":80.0,"y":120.0},"frameSize":{"width":320.0,"height":220.0}}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("Renamed Inputs", sheet.name)
        assertEquals(WorkspacePosition(80.0, 120.0), sheet.position)
        assertEquals(SheetFrameSize(320.0, 220.0), sheet.frameSize)
    }

    @Test
    fun `sheet update endpoint persists position without requiring rename`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val response = client.patch("/api/sheets/sheet-1") {
            revisionHeader(repo, "sheet-1")
            jsonBody("""{"position":{"x":-10.0,"y":32.5}}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("Inputs", sheet.name)
        assertEquals(WorkspacePosition(-10.0, 32.5), sheet.position)
    }

    @Test
    fun `sheet update endpoint persists frame size without requiring rename`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val response = client.patch("/api/sheets/sheet-1") {
            revisionHeader(repo, "sheet-1")
            jsonBody("""{"frameSize":{"width":360.0,"height":240.0}}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("Inputs", sheet.name)
        assertEquals(SheetFrameSize(360.0, 240.0), sheet.frameSize)
    }

    @Test
    fun `sheet update endpoint persists z-order without requiring rename`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val response = client.patch("/api/sheets/sheet-1") {
            revisionHeader(repo, "sheet-1")
            jsonBody("""{"zIndex":3}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("Inputs", sheet.name)
        assertEquals(3, sheet.zIndex)
    }

    @Test
    fun `row and column append endpoints persist updated dimensions`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val rowResponse = client.post("/api/sheets/sheet-1/rows") {
            revisionHeader(repo, "sheet-1")
        }
        val columnResponse = client.post("/api/sheets/sheet-1/columns") {
            revisionHeader(repo, "sheet-1")
        }

        assertEquals(HttpStatusCode.OK, rowResponse.status)
        assertEquals(HttpStatusCode.OK, columnResponse.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals(DEFAULT_ROW_COUNT + 1, sheet.rowCount)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, sheet.columnCount)
    }

    @Test
    fun `api mutations persist complete MVP workbook state for later reloads`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }

        val createInputs = client.post("/api/sheets") {
            jsonBody("""{"id":"sheet-inputs","name":"Inputs","position":{"x":24.0,"y":48.0}}""")
        }
        val createOutputs = client.post("/api/sheets") {
            jsonBody("""{"id":"sheet-outputs","name":"Outputs","position":{"x":420.0,"y":260.0}}""")
        }
        val renameAndMoveInputs = client.patch("/api/sheets/sheet-inputs") {
            revisionHeader(repo, "sheet-inputs")
            jsonBody("""{"name":"Renamed Inputs","position":{"x":72.0,"y":144.0},"frameSize":{"width":320.0,"height":220.0}}""")
        }
        val appendInputRow = client.post("/api/sheets/sheet-inputs/rows") {
            revisionHeader(repo, "sheet-inputs")
        }
        val appendInputColumn = client.post("/api/sheets/sheet-inputs/columns") {
            revisionHeader(repo, "sheet-inputs")
        }
        val updateTextCell = client.put("/api/sheets/sheet-inputs/cells/A1") {
            revisionHeader(repo, "sheet-inputs")
            jsonBody("""{"raw":"Region"}""")
        }
        val updateNumericCell = client.put("/api/sheets/sheet-inputs/cells/B1") {
            revisionHeader(repo, "sheet-inputs")
            jsonBody("""{"raw":"10"}""")
        }
        val updateSecondNumericCell = client.put("/api/sheets/sheet-inputs/cells/B2") {
            revisionHeader(repo, "sheet-inputs")
            jsonBody("""{"raw":"5"}""")
        }
        val updateFormulaCell = client.put("/api/sheets/sheet-inputs/cells/C1") {
            revisionHeader(repo, "sheet-inputs")
            jsonBody("""{"raw":"= \n SuM ( B1 , B2 )"}""")
        }
        val updateCrossSheetFormulaCell = client.put("/api/sheets/sheet-outputs/cells/A1") {
            revisionHeader(repo, "sheet-outputs")
            jsonBody("""{"raw":"=SUM(Renamed Inputs!B1:B2)"}""")
        }

        assertEquals(HttpStatusCode.Created, createInputs.status)
        assertEquals(HttpStatusCode.Created, createOutputs.status)
        assertEquals(HttpStatusCode.OK, renameAndMoveInputs.status)
        assertEquals(HttpStatusCode.OK, appendInputRow.status)
        assertEquals(HttpStatusCode.OK, appendInputColumn.status)
        assertEquals(HttpStatusCode.OK, updateTextCell.status)
        assertEquals(HttpStatusCode.OK, updateNumericCell.status)
        assertEquals(HttpStatusCode.OK, updateSecondNumericCell.status)
        assertEquals(HttpStatusCode.OK, updateFormulaCell.status)
        assertEquals(HttpStatusCode.OK, updateCrossSheetFormulaCell.status)

        val workbook = client.loadWorkbook()
        val inputs = workbook.sheets.single { it.id == "sheet-inputs" }
        val outputs = workbook.sheets.single { it.id == "sheet-outputs" }

        assertEquals("Renamed Inputs", inputs.name)
        assertEquals(WorkspacePosition(72.0, 144.0), inputs.position)
        assertEquals(SheetFrameSize(320.0, 220.0), inputs.frameSize)
        assertEquals(DEFAULT_ROW_COUNT + 1, inputs.rowCount)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, inputs.columnCount)
        assertEquals("Region", inputs.cells.getValue("A1").raw)
        assertEquals("10", inputs.cells.getValue("B1").raw)
        assertEquals("5", inputs.cells.getValue("B2").raw)
        assertEquals("= \n SuM ( B1 , B2 )", inputs.cells.getValue("C1").raw)
        assertEquals(WorkspacePosition(420.0, 260.0), outputs.position)
        assertEquals("=SUM(Renamed Inputs!B1:B2)", outputs.cells.getValue("A1").raw)
        assertFalse(inputs.cells.containsKey("C1_display"))
        assertFalse(outputs.cells.containsKey("A1_display"))
    }

    @Test
    fun `invalid update payloads return 4xx without corrupting workbook data`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val invalidRename = client.patch("/api/sheets/sheet-1") {
            revisionHeader(repo, "sheet-1")
            jsonBody("""{"name":"   "}""")
        }
        val invalidCell = client.put("/api/sheets/sheet-1/cells/Z999") {
            revisionHeader(repo, "sheet-1")
            jsonBody("""{"raw":"outside grid"}""")
        }
        val invalidFrameSize = client.patch("/api/sheets/sheet-1") {
            revisionHeader(repo, "sheet-1")
            jsonBody("""{"frameSize":{"width":0.0,"height":160.0}}""")
        }
        val missingSheet = client.post("/api/sheets/missing/rows")

        assertEquals(HttpStatusCode.BadRequest, invalidRename.status)
        assertEquals(HttpStatusCode.BadRequest, invalidCell.status)
        assertEquals(HttpStatusCode.BadRequest, invalidFrameSize.status)
        assertEquals(HttpStatusCode.NotFound, missingSheet.status)
        assertEquals(Sheet(id = "sheet-1", name = "Inputs"), client.loadWorkbook().sheets.single())
    }

    @Test
    fun `revisioned mutations require valid sheet revision headers`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val missingRevision = client.put("/api/sheets/sheet-1/cells/A1") {
            jsonBody("""{"raw":"value"}""")
        }
        val invalidRevision = client.put("/api/sheets/sheet-1/cells/A1") {
            header("If-Match", "not-a-revision")
            jsonBody("""{"raw":"value"}""")
        }

        assertEquals(HttpStatusCode.BadRequest, missingRevision.status)
        assertEquals(ErrorResponse(error = "sheet-revision-required"), missingRevision.decodeBody<ErrorResponse>())
        assertEquals(HttpStatusCode.BadRequest, invalidRevision.status)
        assertEquals(ErrorResponse(error = "invalid-sheet-revision"), invalidRevision.decodeBody<ErrorResponse>())
        assertEquals(emptyMap(), client.loadWorkbook().sheets.single().cells)
    }

    @Test
    fun `invalid sheet rename returns name error before stale revision conflict`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()
        val initialRevision = client.loadWorkbook().sheets.single().revision
        val firstUpdate = client.put("/api/sheets/sheet-1/cells/A1") {
            header("If-Match", initialRevision.toString())
            jsonBody("""{"raw":"newer value"}""")
        }

        val invalidRename = client.patch("/api/sheets/sheet-1") {
            header("If-Match", initialRevision.toString())
            jsonBody("""{"name":"   "}""")
        }

        assertEquals(HttpStatusCode.OK, firstUpdate.status)
        assertEquals(HttpStatusCode.BadRequest, invalidRename.status)
        assertEquals(ErrorResponse(error = "sheet-name-required"), invalidRename.decodeBody<ErrorResponse>())
    }

    @Test
    fun `malformed request bodies return structured 4xx errors without corrupting workbook data`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val malformedJson = client.post("/api/sheets") {
            jsonBody("""{"id":"sheet-2","name":""")
        }
        val missingField = client.post("/api/sheets") {
            jsonBody("""{"id":"sheet-2"}""")
        }

        assertEquals(HttpStatusCode.BadRequest, malformedJson.status)
        assertEquals(ErrorResponse(error = "invalid-request"), malformedJson.decodeBody<ErrorResponse>())
        assertEquals(HttpStatusCode.BadRequest, missingField.status)
        assertEquals(ErrorResponse(error = "invalid-request"), missingField.decodeBody<ErrorResponse>())
        assertEquals(Sheet(id = "sheet-1", name = "Inputs"), client.loadWorkbook().sheets.single())
    }

    @Test
    fun `health endpoint returns ok payload`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }

        val response = client.get("/api/health")

        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        assertTrue(body.contains("\"status\":\"ok\""))
        assertTrue(body.contains("\"service\":\"sheetspace-api\""))
    }

    private fun createRepo(): WorkbookRepository {
        return WorkbookRepository(Files.createTempFile("sheetspace-application", ".sqlite"))
    }

    private suspend fun HttpClient.createSheet() {
        val response = post("/api/sheets") {
            jsonBody("""{"id":"sheet-1","name":"Inputs","position":{"x":0.0,"y":0.0}}""")
        }
        assertEquals(HttpStatusCode.Created, response.status)
    }

    private suspend fun HttpClient.loadWorkbook(): Workbook {
        return get("/api/workbook").decodeBody()
    }

    private fun io.ktor.client.request.HttpRequestBuilder.revisionHeader(repo: WorkbookRepository, sheetId: String) {
        val revision = repo.loadWorkbook().sheets.single { it.id == sheetId }.revision
        header("If-Match", revision.toString())
    }

    private suspend inline fun <reified T> io.ktor.client.statement.HttpResponse.decodeBody(): T {
        return json.decodeFromString(bodyAsText())
    }

    private fun io.ktor.client.request.HttpRequestBuilder.jsonBody(body: String) {
        contentType(ContentType.Application.Json)
        setBody(body)
    }
}
