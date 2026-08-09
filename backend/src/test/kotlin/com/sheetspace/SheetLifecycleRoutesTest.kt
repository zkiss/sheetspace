package com.sheetspace

import io.ktor.client.request.delete
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.http.HttpStatusCode
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals

class SheetLifecycleRoutesTest {
    @Test
    fun `sheet creation endpoint persists sheet for later workbook loads`() =
        testWorkbookApplication {
            val response = client.post("/api/sheets") {
                jsonBody("""{"name":" Inputs ","position":{"x":24.0,"y":48.0}}""")
            }

            assertEquals(HttpStatusCode.Created, response.status)
            val created = response.decodeBody<SheetDocumentResponse>()
            UUID.fromString(created.id)
            val workbook = client.loadWorkbook()
            assertEquals(listOf(created.toTestSheet()), workbook.sheets)
            assertEquals("Inputs", created.name)
            assertEquals(WorkspacePosition(24.0, 48.0), created.frame.position)
        }

    @Test
    fun `sheet creation endpoint rejects client supplied ids`() =
        testWorkbookApplication {
            val response = client.post("/api/sheets") {
                jsonBody("""{"id":"client-sheet","name":"Inputs"}""")
            }

            assertEquals(HttpStatusCode.BadRequest, response.status)
            assertEquals(ErrorResponse(error = "invalid-request"), response.decodeBody<ErrorResponse>())
            assertEquals(TestWorkbook(), client.loadWorkbook())
        }

    @Test
    fun `sheet deletion endpoint persists removal for later workbook loads`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id

            val response = client.delete("/api/sheets/$sheetId") {
                revisionHeader(workbookApplication, sheetId)
            }

            assertEquals(HttpStatusCode.NoContent, response.status)
            assertEquals(TestWorkbook(), client.loadWorkbook())
        }

    @Test
    fun `sheet deletion endpoint reports missing sheet ids`() =
        testWorkbookApplication {
            val response = client.delete("/api/sheets/${UUID.randomUUID()}")

            assertEquals(HttpStatusCode.NotFound, response.status)
            assertEquals(ErrorResponse(error = "sheet-not-found"), response.decodeBody<ErrorResponse>())
        }

    @Test
    fun `stale sheet deletion returns conflict without removing newer sheet state`() =
        testWorkbookApplication {
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
    fun `sheet update endpoint persists rename position and frame size`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id

            val response = client.patch("/api/sheets/$sheetId") {
                revisionHeader(workbookApplication, sheetId)
                jsonBody(
                    """{"name":"Renamed Inputs","position":{"x":80.0,"y":120.0},"frameSize":{"width":320.0,"height":220.0}}""",
                )
            }

            assertEquals(HttpStatusCode.OK, response.status)
            val sheet = client.loadWorkbook().sheets.single()
            assertEquals("Renamed Inputs", sheet.name)
            assertEquals(WorkspacePosition(80.0, 120.0), sheet.position)
            assertEquals(SheetFrameSize(320.0, 220.0), sheet.frameSize)
        }

    @Test
    fun `sheet update endpoint persists position without requiring rename`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id

            val response = client.patch("/api/sheets/$sheetId") {
                revisionHeader(workbookApplication, sheetId)
                jsonBody("""{"position":{"x":-10.0,"y":32.5}}""")
            }

            assertEquals(HttpStatusCode.OK, response.status)
            val sheet = client.loadWorkbook().sheets.single()
            assertEquals("Inputs", sheet.name)
            assertEquals(WorkspacePosition(-10.0, 32.5), sheet.position)
        }

    @Test
    fun `sheet update endpoint persists frame size without requiring rename`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id

            val response = client.patch("/api/sheets/$sheetId") {
                revisionHeader(workbookApplication, sheetId)
                jsonBody("""{"frameSize":{"width":360.0,"height":240.0}}""")
            }

            assertEquals(HttpStatusCode.OK, response.status)
            val sheet = client.loadWorkbook().sheets.single()
            assertEquals("Inputs", sheet.name)
            assertEquals(SheetFrameSize(360.0, 240.0), sheet.frameSize)
        }

    @Test
    fun `row and column append endpoints persist updated dimensions`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id

            val rowResponse = client.post("/api/sheets/$sheetId/rows") {
                revisionHeader(workbookApplication, sheetId)
            }
            val columnResponse = client.post("/api/sheets/$sheetId/columns") {
                revisionHeader(workbookApplication, sheetId)
            }

            assertEquals(HttpStatusCode.OK, rowResponse.status)
            assertEquals(HttpStatusCode.OK, columnResponse.status)
            val sheet = client.loadWorkbook().sheets.single()
            assertEquals(DEFAULT_ROW_COUNT + 1, sheet.rowCount)
            assertEquals(DEFAULT_COLUMN_COUNT + 1, sheet.columnCount)
        }
}
