package com.sheetspace

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.delete
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
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ApplicationTest {
    private val json = Json { ignoreUnknownKeys = false }

    @Test
    fun `workbook endpoint returns metadata and sheet ids without sheet payloads`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheet = client.createSheet()

        val response = client.get("/api/workbook")

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(WorkbookSummary(sheetIds = listOf(sheet.id)), response.decodeBody<WorkbookSummary>())
        assertFalse(response.bodyAsText().contains("cells"))
    }

    @Test
    fun `targeted sheet endpoint returns one full sheet and reports missing sheets`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheet = client.createSheet()

        val found = client.get("/api/sheets/${sheet.id}")
        val missing = client.get("/api/sheets/${UUID.randomUUID()}")

        assertEquals(HttpStatusCode.OK, found.status)
        assertEquals(sheet, found.decodeBody<Sheet>())
        assertEquals(HttpStatusCode.NotFound, missing.status)
        assertEquals(ErrorResponse(error = "sheet-not-found"), missing.decodeBody<ErrorResponse>())
    }

    @Test
    fun `sheet creation endpoint persists sheet for later workbook loads`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }

        val response = client.post("/api/sheets") {
            jsonBody("""{"name":" Inputs ","position":{"x":24.0,"y":48.0}}""")
        }

        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.decodeBody<Sheet>()
        UUID.fromString(created.id)
        val workbook = client.loadWorkbook()
        assertEquals(
            listOf(created),
            workbook.sheets,
        )
        assertEquals("Inputs", created.name)
        assertEquals(WorkspacePosition(24.0, 48.0), created.position)
    }

    @Test
    fun `sheet creation endpoint rejects client supplied ids`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }

        val response = client.post("/api/sheets") {
            jsonBody("""{"id":"client-sheet","name":"Inputs"}""")
        }

        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals(ErrorResponse(error = "invalid-request"), response.decodeBody<ErrorResponse>())
        assertEquals(emptyWorkbook(), client.loadWorkbook())
    }

    @Test
    fun `sheet deletion endpoint persists removal for later workbook loads`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheetId = client.createSheet().id

        val response = client.delete("/api/sheets/$sheetId") {
            revisionHeader(repo, sheetId)
        }

        assertEquals(HttpStatusCode.NoContent, response.status)
        assertEquals(emptyWorkbook(), client.loadWorkbook())
    }

    @Test
    fun `sheet deletion endpoint reports missing sheet ids`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }

        val response = client.delete("/api/sheets/${UUID.randomUUID()}")

        assertEquals(HttpStatusCode.NotFound, response.status)
        assertEquals(ErrorResponse(error = "sheet-not-found"), response.decodeBody<ErrorResponse>())
    }

    @Test
    fun `stale sheet deletion returns conflict without removing newer sheet state`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheetId = client.createSheet().id
        val initialRevision = client.loadWorkbook().sheets.single().revision

        val firstUpdate = client.put("/api/sheets/$sheetId/cells/A1") {
            header("If-Match", initialRevision.toString())
            cellBody("newer value")
        }
        val staleDelete = client.delete("/api/sheets/$sheetId") {
            header("If-Match", initialRevision.toString())
        }

        assertEquals(HttpStatusCode.OK, firstUpdate.status)
        assertEquals(HttpStatusCode.Conflict, staleDelete.status)
        assertEquals(ErrorResponse(error = "sheet-revision-conflict"), staleDelete.decodeBody<ErrorResponse>())
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals(sheetId, sheet.id)
        assertEquals("newer value", sheet.cells.getValue("A1"))
    }

    @Test
    fun `cell update endpoint persists raw content without evaluated formula artifacts`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheetId = client.createSheet().id

        val response = client.put("/api/sheets/$sheetId/cells/A1") {
            revisionHeader(repo, sheetId)
            cellBody("=SUM(B1:B2)")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("=SUM(B1:B2)", sheet.cells.getValue("A1"))
        assertFalse(sheet.cells.containsKey("A1_display"))
    }

    @Test
    fun `cell update endpoint deletes stored content when given an empty string`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheetId = client.createSheet().id

        val storeResponse = client.put("/api/sheets/$sheetId/cells/A1") {
            revisionHeader(repo, sheetId)
            cellBody("value")
        }
        val clearResponse = client.put("/api/sheets/$sheetId/cells/A1") {
            revisionHeader(repo, sheetId)
            cellBody("")
        }

        assertEquals(HttpStatusCode.OK, storeResponse.status)
        assertEquals(HttpStatusCode.OK, clearResponse.status)
        assertFalse(client.loadWorkbook().sheets.single().cells.containsKey("A1"))
    }

    @Test
    fun `cell update endpoint rejects obsolete object bodies`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheetId = client.createSheet().id

        val rawObject = client.put("/api/sheets/$sheetId/cells/A1") {
            revisionHeader(repo, sheetId)
            jsonBody("""{"raw":"value"}""")
        }
        val referenceObject = client.put("/api/sheets/$sheetId/cells/A1") {
            revisionHeader(repo, sheetId)
            jsonBody(
                """
                {
                  "raw": "=SUM(Inputs!A1)",
                  "sheetReferences": []
                }
                """.trimIndent(),
            )
        }

        assertEquals(HttpStatusCode.BadRequest, rawObject.status)
        assertEquals("invalid-request", rawObject.decodeBody<ErrorResponse>().error)
        assertEquals(HttpStatusCode.BadRequest, referenceObject.status)
        assertEquals("invalid-request", referenceObject.decodeBody<ErrorResponse>().error)
        assertTrue(client.loadWorkbook().sheets.single().cells.isEmpty())
    }

    @Test
    fun `stale sheet revision mutation returns conflict without overwriting newer content`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheetId = client.createSheet().id
        val initialRevision = client.loadWorkbook().sheets.single().revision

        val firstUpdate = client.put("/api/sheets/$sheetId/cells/A1") {
            header("If-Match", initialRevision.toString())
            cellBody("newer value")
        }
        val staleUpdate = client.put("/api/sheets/$sheetId/cells/A1") {
            header("If-Match", initialRevision.toString())
            cellBody("stale value")
        }

        assertEquals(HttpStatusCode.OK, firstUpdate.status)
        assertEquals(HttpStatusCode.Conflict, staleUpdate.status)
        assertEquals(ErrorResponse(error = "sheet-revision-conflict"), staleUpdate.decodeBody<ErrorResponse>())
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("newer value", sheet.cells.getValue("A1"))
        assertTrue(sheet.revision > initialRevision)
    }

    @Test
    fun `sheet update endpoint persists rename position and frame size`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheetId = client.createSheet().id

        val response = client.patch("/api/sheets/$sheetId") {
            revisionHeader(repo, sheetId)
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
        val sheetId = client.createSheet().id

        val response = client.patch("/api/sheets/$sheetId") {
            revisionHeader(repo, sheetId)
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
        val sheetId = client.createSheet().id

        val response = client.patch("/api/sheets/$sheetId") {
            revisionHeader(repo, sheetId)
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
        val sheetId = client.createSheet().id

        val response = client.patch("/api/sheets/$sheetId") {
            revisionHeader(repo, sheetId)
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
        val sheetId = client.createSheet().id

        val rowResponse = client.post("/api/sheets/$sheetId/rows") {
            revisionHeader(repo, sheetId)
        }
        val columnResponse = client.post("/api/sheets/$sheetId/columns") {
            revisionHeader(repo, sheetId)
        }

        assertEquals(HttpStatusCode.OK, rowResponse.status)
        assertEquals(HttpStatusCode.OK, columnResponse.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals(DEFAULT_ROW_COUNT + 1, sheet.rowCount)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, sheet.columnCount)
    }

    @Test
    fun `routine mutation endpoints return minimal responses without ok flags`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheetId = client.createSheet().id

        val patchResponse = client.patch("/api/sheets/$sheetId") {
            revisionHeader(repo, sheetId)
            jsonBody("""{"name":"Renamed Inputs"}""")
        }
        val cellResponse = client.put("/api/sheets/$sheetId/cells/A1") {
            revisionHeader(repo, sheetId)
            cellBody("value")
        }
        val rowResponse = client.post("/api/sheets/$sheetId/rows") {
            revisionHeader(repo, sheetId)
        }
        val columnResponse = client.post("/api/sheets/$sheetId/columns") {
            revisionHeader(repo, sheetId)
        }
        val deleteResponse = client.delete("/api/sheets/$sheetId") {
            revisionHeader(repo, sheetId)
        }

        val patchBody = patchResponse.bodyAsText()
        val cellBody = cellResponse.bodyAsText()
        val rowBody = rowResponse.bodyAsText()
        val columnBody = columnResponse.bodyAsText()

        assertEquals(HttpStatusCode.OK, patchResponse.status)
        assertEquals(HttpStatusCode.OK, cellResponse.status)
        assertEquals(HttpStatusCode.OK, rowResponse.status)
        assertEquals(HttpStatusCode.OK, columnResponse.status)
        assertEquals(HttpStatusCode.NoContent, deleteResponse.status)
        assertEquals(SheetRevisionResponse(sheetId = sheetId, revision = 1), json.decodeFromString(patchBody))
        assertEquals(SheetRevisionResponse(sheetId = sheetId, revision = 2), json.decodeFromString(cellBody))
        assertEquals(RowAppendResponse(sheetId = sheetId, revision = 3, rowCount = DEFAULT_ROW_COUNT + 1), json.decodeFromString(rowBody))
        assertEquals(
            ColumnAppendResponse(sheetId = sheetId, revision = 4, columnCount = DEFAULT_COLUMN_COUNT + 1),
            json.decodeFromString(columnBody),
        )
        assertFalse(patchBody.contains("ok"))
        assertFalse(cellBody.contains("ok"))
        assertFalse(rowBody.contains("ok"))
        assertFalse(columnBody.contains("ok"))
        assertEquals("", deleteResponse.bodyAsText())
    }

    @Test
    fun `api mutations persist complete MVP workbook state for later reloads`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }

        val createInputs = client.post("/api/sheets") {
            jsonBody("""{"name":"Inputs","position":{"x":24.0,"y":48.0}}""")
        }
        val createOutputs = client.post("/api/sheets") {
            jsonBody("""{"name":"Outputs","position":{"x":420.0,"y":260.0}}""")
        }
        val inputsId = createInputs.decodeBody<Sheet>().id
        val outputsId = createOutputs.decodeBody<Sheet>().id
        val renameAndMoveInputs = client.patch("/api/sheets/$inputsId") {
            revisionHeader(repo, inputsId)
            jsonBody("""{"name":"Renamed Inputs","position":{"x":72.0,"y":144.0},"frameSize":{"width":320.0,"height":220.0}}""")
        }
        val appendInputRow = client.post("/api/sheets/$inputsId/rows") {
            revisionHeader(repo, inputsId)
        }
        val appendInputColumn = client.post("/api/sheets/$inputsId/columns") {
            revisionHeader(repo, inputsId)
        }
        val updateTextCell = client.put("/api/sheets/$inputsId/cells/A1") {
            revisionHeader(repo, inputsId)
            cellBody("Region")
        }
        val updateNumericCell = client.put("/api/sheets/$inputsId/cells/B1") {
            revisionHeader(repo, inputsId)
            cellBody("10")
        }
        val updateSecondNumericCell = client.put("/api/sheets/$inputsId/cells/B2") {
            revisionHeader(repo, inputsId)
            cellBody("5")
        }
        val updateFormulaCell = client.put("/api/sheets/$inputsId/cells/C1") {
            revisionHeader(repo, inputsId)
            cellBody("= \n SuM ( B1 , B2 )")
        }
        val updateCrossSheetFormulaCell = client.put("/api/sheets/$outputsId/cells/A1") {
            revisionHeader(repo, outputsId)
            cellBody("=SUM($inputsId!B1:B2)")
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
        val inputs = workbook.sheets.single { it.id == inputsId }
        val outputs = workbook.sheets.single { it.id == outputsId }

        assertEquals("Renamed Inputs", inputs.name)
        assertEquals(WorkspacePosition(72.0, 144.0), inputs.position)
        assertEquals(SheetFrameSize(320.0, 220.0), inputs.frameSize)
        assertEquals(DEFAULT_ROW_COUNT + 1, inputs.rowCount)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, inputs.columnCount)
        assertEquals("Region", inputs.cells.getValue("A1"))
        assertEquals("10", inputs.cells.getValue("B1"))
        assertEquals("5", inputs.cells.getValue("B2"))
        assertEquals("= \n SuM ( B1 , B2 )", inputs.cells.getValue("C1"))
        assertEquals(WorkspacePosition(420.0, 260.0), outputs.position)
        assertEquals("=SUM($inputsId!B1:B2)", outputs.cells.getValue("A1"))
        assertFalse(inputs.cells.containsKey("C1_display"))
        assertFalse(outputs.cells.containsKey("A1_display"))
    }

    @Test
    fun `invalid update payloads return 4xx without corrupting workbook data`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheet = client.createSheet()

        val invalidRename = client.patch("/api/sheets/${sheet.id}") {
            revisionHeader(repo, sheet.id)
            jsonBody("""{"name":"   "}""")
        }
        val invalidCell = client.put("/api/sheets/${sheet.id}/cells/Z999") {
            revisionHeader(repo, sheet.id)
            cellBody("outside grid")
        }
        val invalidFrameSize = client.patch("/api/sheets/${sheet.id}") {
            revisionHeader(repo, sheet.id)
            jsonBody("""{"frameSize":{"width":0.0,"height":160.0}}""")
        }
        val missingSheet = client.post("/api/sheets/missing/rows")

        assertEquals(HttpStatusCode.BadRequest, invalidRename.status)
        assertEquals(HttpStatusCode.BadRequest, invalidCell.status)
        assertEquals(HttpStatusCode.BadRequest, invalidFrameSize.status)
        assertEquals(HttpStatusCode.NotFound, missingSheet.status)
        assertEquals(sheet, client.loadWorkbook().sheets.single())
    }

    @Test
    fun `revisioned mutations require valid sheet revision headers`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        val sheetId = client.createSheet().id

        val missingRevision = client.put("/api/sheets/$sheetId/cells/A1") {
            cellBody("value")
        }
        val missingDeleteRevision = client.delete("/api/sheets/$sheetId")
        val invalidRevision = client.put("/api/sheets/$sheetId/cells/A1") {
            header("If-Match", "not-a-revision")
            cellBody("value")
        }

        assertEquals(HttpStatusCode.BadRequest, missingRevision.status)
        assertEquals(ErrorResponse(error = "sheet-revision-required"), missingRevision.decodeBody<ErrorResponse>())
        assertEquals(HttpStatusCode.BadRequest, missingDeleteRevision.status)
        assertEquals(ErrorResponse(error = "sheet-revision-required"), missingDeleteRevision.decodeBody<ErrorResponse>())
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
        val sheetId = client.createSheet().id
        val initialRevision = client.loadWorkbook().sheets.single().revision
        val firstUpdate = client.put("/api/sheets/$sheetId/cells/A1") {
            header("If-Match", initialRevision.toString())
            cellBody("newer value")
        }

        val invalidRename = client.patch("/api/sheets/$sheetId") {
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
        val sheet = client.createSheet()

        val malformedJson = client.post("/api/sheets") {
            jsonBody("""{"name":""")
        }
        val missingField = client.post("/api/sheets") {
            jsonBody("""{}""")
        }

        assertEquals(HttpStatusCode.BadRequest, malformedJson.status)
        val malformedBody = malformedJson.bodyAsText()
        assertEquals(ErrorResponse(error = "invalid-request"), json.decodeFromString<ErrorResponse>(malformedBody))
        assertFalse(malformedBody.contains("ok"))
        assertEquals(HttpStatusCode.BadRequest, missingField.status)
        assertEquals(ErrorResponse(error = "invalid-request"), missingField.decodeBody<ErrorResponse>())
        assertEquals(sheet, client.loadWorkbook().sheets.single())
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

    private suspend fun HttpClient.createSheet(): Sheet {
        val response = post("/api/sheets") {
            jsonBody("""{"name":"Inputs","position":{"x":0.0,"y":0.0}}""")
        }
        assertEquals(HttpStatusCode.Created, response.status)
        return response.decodeBody<Sheet>()
    }

    private suspend fun HttpClient.loadWorkbook(): Workbook {
        val summary = get("/api/workbook").decodeBody<WorkbookSummary>()
        return Workbook(
            version = summary.version,
            sheets = summary.sheetIds.map { sheetId -> get("/api/sheets/$sheetId").decodeBody<Sheet>() },
        )
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

    private fun io.ktor.client.request.HttpRequestBuilder.cellBody(content: String) {
        jsonBody(json.encodeToString(content))
    }
}
