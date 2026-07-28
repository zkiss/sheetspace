package com.sheetspace

import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkbookReadRoutesTest {
    @Test
    fun `workbook endpoint returns metadata and sheet ids without sheet payloads`() =
        testWorkbookApplication {
            val sheet = client.createSheet()

            val response = client.get("/api/workbook")

            assertEquals(HttpStatusCode.OK, response.status)
            assertEquals(WorkbookSummary(sheetIds = listOf(sheet.id)), response.decodeBody<WorkbookSummary>())
            assertFalse(response.bodyAsText().contains("cells"))
        }

    @Test
    fun `targeted sheet endpoint returns one full sheet and reports missing sheets`() =
        testWorkbookApplication {
            val sheet = client.createSheet()

            val found = client.get("/api/sheets/${sheet.id}")
            val missing = client.get("/api/sheets/${UUID.randomUUID()}")

            assertEquals(HttpStatusCode.OK, found.status)
            assertEquals(sheet, found.decodeBody<Sheet>())
            assertEquals(HttpStatusCode.NotFound, missing.status)
            assertEquals(ErrorResponse(error = "sheet-not-found"), missing.decodeBody<ErrorResponse>())
        }

    @Test
    fun `health endpoint returns ok payload`() = testWorkbookApplication {
        val response = client.get("/api/health")

        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        assertTrue(body.contains("\"status\":\"ok\""))
        assertTrue(body.contains("\"service\":\"sheetspace-api\""))
    }
}
