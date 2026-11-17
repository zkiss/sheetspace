package com.sheetspace

import io.ktor.client.request.patch
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.nio.file.Files
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CellMutationRoutesTest {
    @Test
    fun `temporal contents pass through the API and sqlite unchanged`() {
        val path = Files.createTempFile("sheetspace-temporal-", ".sqlite")
        try {
            SqliteWorkbookStore(path).use { store ->
                testApplication {
                    application { module(DefaultWorkbookApplication(store)) }
                    val sheet = client.createSheet()
                    val values = mapOf(
                        "A1" to "@date:2024-02-29",
                        "B1" to "@datetime:2024-02-29 00:00:00.120000000",
                        "C1" to "\"2024-02-29\"",
                        "D1" to "=@${sheet.content.columns[1]}[${sheet.content.rows[0]}]",
                    )
                    val writes = values.map { (address, raw) ->
                        val column = address[0] - 'A'
                        CellWriteRequest(sheet.id, sheet.content.rows[0], sheet.content.columns[column], raw)
                    }
                    val response = client.patch("/api/cells") {
                        jsonBody(testJson.encodeToString(CellPatchRequest(listOf(CellRevisionRequest(sheet.id, 0)), writes)))
                    }
                    assertEquals(HttpStatusCode.OK, response.status)
                    assertEquals(values, client.loadWorkbook().sheets.single().cells)
                    val bundle = client.get("/api/workbook/bundle").bodyAsText()
                    val script = Files.createTempFile("sheetspace-temporal-test-", ".cjs")
                    try {
                        val compile = ProcessBuilder(
                            "../frontend/node_modules/.bin/esbuild", "src/test/typescript/temporalRoundtrip.ts",
                            "--bundle", "--platform=node", "--tsconfig=../frontend/tsconfig.json", "--outfile=$script",
                        ).redirectErrorStream(true).start()
                        val diagnostics = compile.inputStream.bufferedReader().readText()
                        assertEquals(0, compile.waitFor(), diagnostics)
                        val check = ProcessBuilder("node", script.toString()).redirectErrorStream(true).start()
                        check.outputStream.bufferedWriter().use { it.write(bundle) }
                        val output = check.inputStream.bufferedReader().readText()
                        assertEquals(0, check.waitFor(), output)
                    } finally {
                        Files.deleteIfExists(script)
                    }
                }
            }
        } finally {
            Files.deleteIfExists(path)
        }
    }
    @Test
    fun `batch cell update commits multiple sheets in cell appearance order and preserves no-op revisions`() =
        testWorkbookApplication { workbookApplication ->
            val inputsId = client.createSheet().id
            val outputs = workbookApplication.createSheet(CreateSheetCommand("Outputs"))
            val inputs = workbookApplication.loadSheet(inputsId)
            fun write(sheet: SheetDocument, address: String, raw: String): CellWriteRequest {
                val coordinate = sheet.tabularContent.coordinateAt(address)!!
                return CellWriteRequest(sheet.id.value, coordinate.rowId.value, coordinate.columnId.value, raw)
            }

            val first = client.patch("/api/cells") {
                jsonBody(testJson.encodeToString(
                    CellPatchRequest(
                        expectedRevisions = listOf(
                            CellRevisionRequest(inputs.id.value, inputs.revision),
                            CellRevisionRequest(outputs.id.value, outputs.revision),
                        ),
                        cells = listOf(
                            write(outputs, "A1", "result"),
                            write(inputs, "B2", "42"),
                            write(inputs, "A1", "source"),
                        ),
                    ),
                ))
            }

            assertEquals(HttpStatusCode.OK, first.status)
            assertEquals(
                CellPatchResponse(
                    listOf(
                        SheetRevisionResponse(outputs.id.value, 1),
                        SheetRevisionResponse(inputs.id.value, 1),
                    ),
                ),
                first.decodeBody(),
            )
            val afterFirst = workbookApplication.loadWorkbookBundle()
            assertEquals("source", afterFirst.documents.getValue(inputs.id).tabularContent.cells.getValue("A1"))
            assertEquals("42", afterFirst.documents.getValue(inputs.id).tabularContent.cells.getValue("B2"))
            assertEquals("result", afterFirst.documents.getValue(outputs.id).tabularContent.cells.getValue("A1"))

            val second = client.patch("/api/cells") {
                jsonBody(testJson.encodeToString(
                    CellPatchRequest(
                        expectedRevisions = listOf(
                            CellRevisionRequest(inputs.id.value, 1),
                            CellRevisionRequest(outputs.id.value, 1),
                        ),
                        cells = listOf(
                            write(afterFirst.documents.getValue(inputs.id), "A1", "source"),
                            write(afterFirst.documents.getValue(outputs.id), "A1", "changed result"),
                        ),
                    ),
                ))
            }

            assertEquals(HttpStatusCode.OK, second.status)
            assertEquals(
                CellPatchResponse(
                    listOf(
                        SheetRevisionResponse(inputs.id.value, 1),
                        SheetRevisionResponse(outputs.id.value, 2),
                    ),
                ),
                second.decodeBody(),
            )
            assertEquals(2, workbookApplication.loadWorkbookBundle().manifest.sheetIds.size)
        }

    @Test
    fun `batch cell update reports a missing later sheet without mutating the bundle`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id
            val sheet = workbookApplication.loadSheet(sheetId)
            val coordinate = sheet.tabularContent.coordinateAt("A1")!!
            val valid = CellWriteRequest(sheetId, coordinate.rowId.value, coordinate.columnId.value, "value")
            val expected = CellRevisionRequest(sheetId, sheet.revision)
            val foreignSheetId = "00000000-0000-0000-0000-000000000099"
            val baseline = workbookApplication.loadWorkbookBundle()
            val response = client.patch("/api/cells") {
                jsonBody(testJson.encodeToString(
                    CellPatchRequest(
                        listOf(expected, CellRevisionRequest(foreignSheetId, 0)),
                        listOf(valid, valid.copy(sheetId = foreignSheetId)),
                    ),
                ))
            }

            assertEquals(HttpStatusCode.NotFound, response.status)
            assertEquals(ErrorResponse("sheet-not-found"), response.decodeBody<ErrorResponse>())
            assertEquals(baseline, workbookApplication.loadWorkbookBundle())
        }

    @Test
    fun `cell update endpoint persists raw content without evaluated formula artifacts`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id
            val canonical =
                "=SUM(@sheet-inputs!\$column-a[row-a]:column-b[\$row-b], @column-c[row-c])"

            val response = client.patchSingleCell(workbookApplication, sheetId, "A1", canonical)

            assertEquals(HttpStatusCode.OK, response.status)
            val sheet = client.loadWorkbook().sheets.single()
            assertEquals(canonical, sheet.cells.getValue("A1"))
            assertFalse(sheet.cells.containsKey("A1_display"))
        }

    @Test
    fun `cell update endpoint deletes stored content when given an empty string`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id

            val storeResponse = client.patchSingleCell(workbookApplication, sheetId, "A1", "value")
            val clearResponse = client.patchSingleCell(workbookApplication, sheetId, "A1", "")

            assertEquals(HttpStatusCode.OK, storeResponse.status)
            assertEquals(HttpStatusCode.OK, clearResponse.status)
            assertFalse(client.loadWorkbook().sheets.single().cells.containsKey("A1"))
        }

    @Test
    fun `cell update endpoint rejects raw-only object bodies without mutating the bundle`() =
        testWorkbookApplication { workbookApplication ->
            client.createSheet()
            val baseline = workbookApplication.loadWorkbookBundle()
            val rawObject = client.patch("/api/cells") {
                jsonBody("""{"raw":"value"}""")
            }

            assertEquals(HttpStatusCode.BadRequest, rawObject.status)
            assertEquals(ErrorResponse("invalid-request"), rawObject.decodeBody<ErrorResponse>())
            assertEquals(baseline, workbookApplication.loadWorkbookBundle())
        }

    @Test
    fun `cell update endpoint rejects raw-plus-reference object bodies without mutating the bundle`() =
        testWorkbookApplication { workbookApplication ->
            client.createSheet()
            val baseline = workbookApplication.loadWorkbookBundle()
            val referenceObject = client.patch("/api/cells") {
                jsonBody(
                    """
                    {
                      "raw": "=SUM(Inputs!A1)",
                      "sheetReferences": []
                    }
                    """.trimIndent(),
                )
            }

            assertEquals(HttpStatusCode.BadRequest, referenceObject.status)
            assertEquals(ErrorResponse("invalid-request"), referenceObject.decodeBody<ErrorResponse>())
            assertEquals(baseline, workbookApplication.loadWorkbookBundle())
        }

    @Test
    fun `stale sheet revision mutation returns conflict without overwriting newer content`() =
        testWorkbookApplication { workbookApplication ->
            val sheetId = client.createSheet().id
            val initial = workbookApplication.loadSheet(sheetId)
            val coordinate = initial.tabularContent.coordinateAt("A1")!!
            val firstUpdate = client.patchSingleCell(workbookApplication, sheetId, "A1", "newer value")
            assertEquals(HttpStatusCode.OK, firstUpdate.status)
            val afterNewerWrite = workbookApplication.loadWorkbookBundle()

            val staleUpdate = client.patch("/api/cells") {
                jsonBody(testJson.encodeToString(CellPatchRequest(
                    listOf(CellRevisionRequest(sheetId, initial.revision)),
                    listOf(CellWriteRequest(sheetId, coordinate.rowId.value, coordinate.columnId.value, "stale value")),
                )))
            }

            assertEquals(HttpStatusCode.Conflict, staleUpdate.status)
            assertEquals(ErrorResponse("sheet-revision-conflict", sheetId, initial.revision, initial.revision + 1), staleUpdate.decodeBody<ErrorResponse>())
            assertEquals(afterNewerWrite, workbookApplication.loadWorkbookBundle())
        }
}
