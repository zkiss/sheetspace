package com.sheetspace

import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkbookReadRoutesTest {
    @Test
    fun `workbook endpoint returns manifest without sheet payloads`() =
        testWorkbookApplication { application ->
            val sheet = client.createSheet()

            val response = client.get("/api/workbook")

            assertEquals(HttpStatusCode.OK, response.status)
            assertEquals(
                WorkbookReadTransportAdapter.manifest(application.loadManifest()),
                response.decodeBody<WorkbookManifestResponse>(),
            )
            assertEquals(listOf(sheet.id), response.decodeBody<WorkbookManifestResponse>().sheetIds)
            assertFalse(response.bodyAsText().contains("cells"))
        }

    @Test
    fun `targeted sheet endpoint returns one full sheet and reports missing sheets`() =
        testWorkbookApplication { application ->
            val sheet = client.createSheet()

            val found = client.get("/api/sheets/${sheet.id}")
            val missing = client.get("/api/sheets/${UUID.randomUUID()}")

            assertEquals(HttpStatusCode.OK, found.status)
            assertEquals(
                WorkbookReadTransportAdapter.sheetDocument(application.loadSheet(sheet.id)),
                found.decodeBody<SheetDocumentResponse>(),
            )
            assertEquals(HttpStatusCode.NotFound, missing.status)
            assertEquals(ErrorResponse(error = "sheet-not-found"), missing.decodeBody<ErrorResponse>())
        }

    @Test
    fun `startup bundle is assembled by one application operation without targeted loads`() = testApplication {
        val first = testDocument(TEST_SHEET_1, "Inputs")
        val second = testDocument(TEST_SHEET_2, "Outputs")
        val countingApplication = CountingReadApplication(
            DefaultWorkbookApplication(InMemoryWorkbookStore(testWorkbookOf(first, second))),
        )
        application { module(countingApplication) }

        val response = client.get("/api/workbook/bundle")

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(listOf(TEST_SHEET_1, TEST_SHEET_2), response.decodeBody<WorkbookBundleResponse>().manifest.sheetIds)
        assertEquals(1, countingApplication.bundleLoads)
        assertEquals(0, countingApplication.manifestLoads)
        assertEquals(0, countingApplication.sheetLoads)
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

private class CountingReadApplication(
    private val delegate: WorkbookApplication,
) : WorkbookApplication by delegate {
    var manifestLoads = 0
    var bundleLoads = 0
    var sheetLoads = 0

    override fun loadManifest(): WorkbookManifest {
        manifestLoads++
        return delegate.loadManifest()
    }

    override fun loadWorkbookBundle(): WorkbookState {
        bundleLoads++
        return delegate.loadWorkbookBundle()
    }

    override fun loadSheet(sheetId: String): SheetDocument {
        sheetLoads++
        return delegate.loadSheet(sheetId)
    }
}
