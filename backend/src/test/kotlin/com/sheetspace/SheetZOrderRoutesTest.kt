package com.sheetspace

import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals

class SheetZOrderRoutesTest {
    @Test
    fun `z-order endpoint atomically updates affected sheets and returns authoritative revisions`() =
        testWorkbookApplication {
            val inputs = client.post("/api/sheets") {
                jsonBody("""{"name":"Inputs"}""")
            }.decodeBody<SheetDocumentResponse>()
            val outputs = client.post("/api/sheets") {
                jsonBody("""{"name":"Outputs"}""")
            }.decodeBody<SheetDocumentResponse>()

            val response = client.patch("/api/workbook/sheet-z-order") {
                jsonBody(
                    """{"updates":[{"sheetId":"${inputs.id}","expectedRevision":0,"zIndex":2},""" +
                        """{"sheetId":"${outputs.id}","expectedRevision":0,"zIndex":1}]}""",
                )
            }

            assertEquals(HttpStatusCode.OK, response.status)
            assertEquals(
                UpdateSheetZOrderResponse(
                    listOf(
                        SheetRevisionResponse(inputs.id, 1),
                        SheetRevisionResponse(outputs.id, 1),
                    ),
                ),
                response.decodeBody<UpdateSheetZOrderResponse>(),
            )
            assertEquals(
                mapOf(inputs.id to 2, outputs.id to 1),
                client.loadWorkbook().sheets.associate { sheet -> sheet.id to sheet.zIndex },
            )
        }

    @Test
    fun `z-order endpoint rejects empty duplicate and invalid updates without mutation`() =
        testWorkbookApplication {
            val sheet = client.createSheet()

            val empty = client.patch("/api/workbook/sheet-z-order") { jsonBody("""{"updates":[]}""") }
            val duplicate = client.patch("/api/workbook/sheet-z-order") {
                jsonBody(
                    """{"updates":[{"sheetId":"${sheet.id}","expectedRevision":0,"zIndex":1},""" +
                        """{"sheetId":"${sheet.id}","expectedRevision":0,"zIndex":2}]}""",
                )
            }
            val invalid = client.patch("/api/workbook/sheet-z-order") {
                jsonBody(
                    """{"updates":[{"sheetId":"${sheet.id}","expectedRevision":0,"zIndex":0}]}""",
                )
            }
            val missing = client.patch("/api/workbook/sheet-z-order") {
                jsonBody(
                    """{"updates":[{"sheetId":"00000000-0000-0000-0000-000000000099","expectedRevision":0,"zIndex":2}]}""",
                )
            }

            assertEquals(HttpStatusCode.BadRequest, empty.status)
            assertEquals(ErrorResponse("sheet-z-order-update-required"), empty.decodeBody<ErrorResponse>())
            assertEquals(HttpStatusCode.BadRequest, duplicate.status)
            assertEquals(ErrorResponse("duplicate-sheet-z-order-update"), duplicate.decodeBody<ErrorResponse>())
            assertEquals(HttpStatusCode.BadRequest, invalid.status)
            assertEquals(ErrorResponse("invalid-sheet-z-index"), invalid.decodeBody<ErrorResponse>())
            assertEquals(HttpStatusCode.NotFound, missing.status)
            assertEquals(ErrorResponse("sheet-not-found"), missing.decodeBody<ErrorResponse>())
            assertEquals(1, client.loadWorkbook().sheets.single().zIndex)
        }
}
