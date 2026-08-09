package com.sheetspace

import io.ktor.client.request.delete
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class WorkbookMutationContractRoutesTest {
    @Test
    fun `routine mutation endpoints return minimal responses without ok flags`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id

            val patchResponse = client.patch("/api/sheets/$sheetId") {
                revisionHeader(workbookApplication, sheetId)
                jsonBody("""{"name":"Renamed Inputs"}""")
            }
            val cellResponse = client.put("/api/sheets/$sheetId/cells/A1") {
                revisionHeader(workbookApplication, sheetId)
                cellBody("value")
            }
            val rowResponse = client.post("/api/sheets/$sheetId/rows") {
                revisionHeader(workbookApplication, sheetId)
            }
            val columnResponse = client.post("/api/sheets/$sheetId/columns") {
                revisionHeader(workbookApplication, sheetId)
            }
            val deleteResponse = client.delete("/api/sheets/$sheetId") {
                revisionHeader(workbookApplication, sheetId)
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
            assertEquals(
                SheetRevisionResponse(sheetId = sheetId, revision = 1),
                testJson.decodeFromString(patchBody),
            )
            assertEquals(
                SheetRevisionResponse(sheetId = sheetId, revision = 2),
                testJson.decodeFromString(cellBody),
            )
            assertEquals(
                RowAppendResponse(sheetId = sheetId, revision = 3, rowCount = DEFAULT_ROW_COUNT + 1),
                testJson.decodeFromString(rowBody),
            )
            assertEquals(
                ColumnAppendResponse(sheetId = sheetId, revision = 4, columnCount = DEFAULT_COLUMN_COUNT + 1),
                testJson.decodeFromString(columnBody),
            )
            assertFalse(patchBody.contains("ok"))
            assertFalse(cellBody.contains("ok"))
            assertFalse(rowBody.contains("ok"))
            assertFalse(columnBody.contains("ok"))
            assertEquals("", deleteResponse.bodyAsText())
        }

    @Test
    fun `api mutations persist complete MVP workbook state for later reloads`() =
        testWorkbookApplication { workbookApplication ->
            val createInputs = client.post("/api/sheets") {
                jsonBody("""{"name":"Inputs","position":{"x":24.0,"y":48.0}}""")
            }
            val createOutputs = client.post("/api/sheets") {
                jsonBody("""{"name":"Outputs","position":{"x":420.0,"y":260.0}}""")
            }
            val inputsId = createInputs.decodeBody<SheetDocumentResponse>().id
            val outputsId = createOutputs.decodeBody<SheetDocumentResponse>().id
            val renameAndMoveInputs = client.patch("/api/sheets/$inputsId") {
                revisionHeader(workbookApplication, inputsId)
                jsonBody(
                    """{"name":"Renamed Inputs","position":{"x":72.0,"y":144.0},"frameSize":{"width":320.0,"height":220.0}}""",
                )
            }
            val appendInputRow = client.post("/api/sheets/$inputsId/rows") {
                revisionHeader(workbookApplication, inputsId)
            }
            val appendInputColumn = client.post("/api/sheets/$inputsId/columns") {
                revisionHeader(workbookApplication, inputsId)
            }
            val updateTextCell = client.put("/api/sheets/$inputsId/cells/A1") {
                revisionHeader(workbookApplication, inputsId)
                cellBody("Region")
            }
            val updateNumericCell = client.put("/api/sheets/$inputsId/cells/B1") {
                revisionHeader(workbookApplication, inputsId)
                cellBody("10")
            }
            val updateSecondNumericCell = client.put("/api/sheets/$inputsId/cells/B2") {
                revisionHeader(workbookApplication, inputsId)
                cellBody("5")
            }
            val updateFormulaCell = client.put("/api/sheets/$inputsId/cells/C1") {
                revisionHeader(workbookApplication, inputsId)
                cellBody("= \n SuM ( B1 , B2 )")
            }
            val updateCrossSheetFormulaCell = client.put("/api/sheets/$outputsId/cells/A1") {
                revisionHeader(workbookApplication, outputsId)
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
    fun `invalid update payloads return 4xx without corrupting workbook data`() =
        testWorkbookApplication { workbookApplication ->
            val sheet = client.createSheet()

            val invalidRename = client.patch("/api/sheets/${sheet.id}") {
                revisionHeader(workbookApplication, sheet.id)
                jsonBody("""{"name":"   "}""")
            }
            val invalidCell = client.put("/api/sheets/${sheet.id}/cells/Z999") {
                revisionHeader(workbookApplication, sheet.id)
                cellBody("outside grid")
            }
            val invalidFrameSize = client.patch("/api/sheets/${sheet.id}") {
                revisionHeader(workbookApplication, sheet.id)
                jsonBody("""{"frameSize":{"width":0.0,"height":160.0}}""")
            }
            val missingSheet = client.post("/api/sheets/missing/rows")

            assertEquals(HttpStatusCode.BadRequest, invalidRename.status)
            assertEquals(HttpStatusCode.BadRequest, invalidCell.status)
            assertEquals(HttpStatusCode.BadRequest, invalidFrameSize.status)
            assertEquals(HttpStatusCode.NotFound, missingSheet.status)
            assertEquals(sheet.toTestSheet(), client.loadWorkbook().sheets.single())
        }

    @Test
    fun `revisioned mutations require valid sheet revision headers`() =
        testWorkbookApplication {
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
            assertEquals(
                ErrorResponse(error = "sheet-revision-required"),
                missingRevision.decodeBody<ErrorResponse>(),
            )
            assertEquals(HttpStatusCode.BadRequest, missingDeleteRevision.status)
            assertEquals(
                ErrorResponse(error = "sheet-revision-required"),
                missingDeleteRevision.decodeBody<ErrorResponse>(),
            )
            assertEquals(HttpStatusCode.BadRequest, invalidRevision.status)
            assertEquals(
                ErrorResponse(error = "invalid-sheet-revision"),
                invalidRevision.decodeBody<ErrorResponse>(),
            )
            assertEquals(emptyMap(), client.loadWorkbook().sheets.single().cells)
        }

    @Test
    fun `invalid sheet rename returns name error before stale revision conflict`() =
        testWorkbookApplication {
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
            assertEquals(
                ErrorResponse(error = "sheet-name-required"),
                invalidRename.decodeBody<ErrorResponse>(),
            )
        }

    @Test
    fun `missing sheet wins over patch command validation after revision parsing`() =
        testWorkbookApplication {
            val emptyUpdate = client.patch("/api/sheets/missing") {
                header("If-Match", "0")
                jsonBody("""{}""")
            }
            val invalidZIndex = client.patch("/api/sheets/missing") {
                header("If-Match", "0")
                jsonBody("""{"zIndex":0}""")
            }

            assertEquals(HttpStatusCode.NotFound, emptyUpdate.status)
            assertEquals(ErrorResponse("sheet-not-found"), emptyUpdate.decodeBody<ErrorResponse>())
            assertEquals(HttpStatusCode.NotFound, invalidZIndex.status)
            assertEquals(ErrorResponse("sheet-not-found"), invalidZIndex.decodeBody<ErrorResponse>())
        }

    @Test
    fun `malformed request bodies return structured 4xx errors without corrupting workbook data`() =
        testWorkbookApplication {
            val sheet = client.createSheet()

            val malformedJson = client.post("/api/sheets") {
                jsonBody("""{"name":""")
            }
            val missingField = client.post("/api/sheets") {
                jsonBody("""{}""")
            }

            assertEquals(HttpStatusCode.BadRequest, malformedJson.status)
            val malformedBody = malformedJson.bodyAsText()
            assertEquals(
                ErrorResponse(error = "invalid-request"),
                testJson.decodeFromString<ErrorResponse>(malformedBody),
            )
            assertFalse(malformedBody.contains("ok"))
            assertEquals(HttpStatusCode.BadRequest, missingField.status)
            assertEquals(ErrorResponse(error = "invalid-request"), missingField.decodeBody<ErrorResponse>())
            assertEquals(sheet.toTestSheet(), client.loadWorkbook().sheets.single())
        }
}
