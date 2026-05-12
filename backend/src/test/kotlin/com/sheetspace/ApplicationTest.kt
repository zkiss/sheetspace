package com.sheetspace

import io.ktor.client.HttpClient
import io.ktor.client.request.get
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
            jsonBody("""{"raw":"=SUM(B1:B2)"}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("=SUM(B1:B2)", sheet.cells.getValue("A1").raw)
        assertFalse(sheet.cells.containsKey("A1_display"))
    }

    @Test
    fun `sheet update endpoint persists rename and position`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val response = client.patch("/api/sheets/sheet-1") {
            jsonBody("""{"name":"Renamed Inputs","position":{"x":80.0,"y":120.0}}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("Renamed Inputs", sheet.name)
        assertEquals(WorkspacePosition(80.0, 120.0), sheet.position)
    }

    @Test
    fun `sheet update endpoint persists position without requiring rename`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val response = client.patch("/api/sheets/sheet-1") {
            jsonBody("""{"position":{"x":-10.0,"y":32.5}}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals("Inputs", sheet.name)
        assertEquals(WorkspacePosition(-10.0, 32.5), sheet.position)
    }

    @Test
    fun `row and column append endpoints persist updated dimensions`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val rowResponse = client.post("/api/sheets/sheet-1/rows")
        val columnResponse = client.post("/api/sheets/sheet-1/columns")

        assertEquals(HttpStatusCode.OK, rowResponse.status)
        assertEquals(HttpStatusCode.OK, columnResponse.status)
        val sheet = client.loadWorkbook().sheets.single()
        assertEquals(DEFAULT_ROW_COUNT + 1, sheet.rowCount)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, sheet.columnCount)
    }

    @Test
    fun `invalid update payloads return 4xx without corrupting workbook data`() = testApplication {
        val repo = createRepo()
        application {
            module(repo)
        }
        client.createSheet()

        val invalidRename = client.patch("/api/sheets/sheet-1") {
            jsonBody("""{"name":"   "}""")
        }
        val invalidCell = client.put("/api/sheets/sheet-1/cells/Z999") {
            jsonBody("""{"raw":"outside grid"}""")
        }
        val missingSheet = client.post("/api/sheets/missing/rows")

        assertEquals(HttpStatusCode.BadRequest, invalidRename.status)
        assertEquals(HttpStatusCode.BadRequest, invalidCell.status)
        assertEquals(HttpStatusCode.NotFound, missingSheet.status)
        assertEquals(Sheet(id = "sheet-1", name = "Inputs"), client.loadWorkbook().sheets.single())
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

    private suspend inline fun <reified T> io.ktor.client.statement.HttpResponse.decodeBody(): T {
        return json.decodeFromString(bodyAsText())
    }

    private fun io.ktor.client.request.HttpRequestBuilder.jsonBody(body: String) {
        contentType(ContentType.Application.Json)
        setBody(body)
    }
}
