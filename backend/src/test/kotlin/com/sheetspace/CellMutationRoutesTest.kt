package com.sheetspace

import io.ktor.client.request.header
import io.ktor.client.request.put
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CellMutationRoutesTest {
    @Test
    fun `cell update endpoint persists raw content without evaluated formula artifacts`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id
            val canonical =
                "=SUM('sheet-inputs'!@[\$column-a,row-a]:@[column-b,\$row-b], @[column-c,row-c])"

            val response = client.put("/api/sheets/$sheetId/cells/A1") {
                revisionHeader(workbookApplication, sheetId)
                cellBody(canonical)
            }

            assertEquals(HttpStatusCode.OK, response.status)
            val sheet = client.loadWorkbook().sheets.single()
            assertEquals(canonical, sheet.cells.getValue("A1"))
            assertFalse(sheet.cells.containsKey("A1_display"))
        }

    @Test
    fun `cell update endpoint deletes stored content when given an empty string`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id

            val storeResponse = client.put("/api/sheets/$sheetId/cells/A1") {
                revisionHeader(workbookApplication, sheetId)
                cellBody("value")
            }
            val clearResponse = client.put("/api/sheets/$sheetId/cells/A1") {
                revisionHeader(workbookApplication, sheetId)
                cellBody("")
            }

            assertEquals(HttpStatusCode.OK, storeResponse.status)
            assertEquals(HttpStatusCode.OK, clearResponse.status)
            assertFalse(client.loadWorkbook().sheets.single().cells.containsKey("A1"))
        }

    @Test
    fun `cell update endpoint rejects obsolete object bodies`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id

            val rawObject = client.put("/api/sheets/$sheetId/cells/A1") {
                revisionHeader(workbookApplication, sheetId)
                jsonBody("""{"raw":"value"}""")
            }
            val referenceObject = client.put("/api/sheets/$sheetId/cells/A1") {
                revisionHeader(workbookApplication, sheetId)
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
    fun `stale sheet revision mutation returns conflict without overwriting newer content`() =
        testWorkbookApplication {
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
}
