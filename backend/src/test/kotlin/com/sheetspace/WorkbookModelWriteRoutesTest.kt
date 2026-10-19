package com.sheetspace

import io.ktor.client.request.put
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class WorkbookModelWriteRoutesTest {
    @Test
    fun `model writes persist through HTTP to a reopened SQLite database`() {
        val database = Files.createTempFile("sheetspace-model-routes-", ".sqlite")
        val modelId = "30000000-0000-0000-0000-000000000001"
        val firstSheet = shapedZeroRowSheet()
        val secondSheet = shapedSheetWithValuesAndFormula()
        lateinit var firstSheetId: String
        lateinit var secondSheetId: String
        try {
            SqliteWorkbookStore(database).use { store ->
                store.saveWorkbook(
                    testWorkbookOf(
                        firstSheet,
                        secondSheet,
                    ),
                )
                testApplication {
                    application { module(DefaultWorkbookApplication(store)) }
                    firstSheetId = TEST_SHEET_1
                    secondSheetId = TEST_SHEET_2

                    assertEquals(HttpStatusCode.OK, client.put("/api/data-models/$modelId") {
                        jsonBody(allTypesModelWriteBody("Invoice", "=SUM(unfinished, named)"))
                    }.status)
                    assertEquals(HttpStatusCode.OK, client.put("/api/sheets/$firstSheetId/model") {
                        jsonBody("""{"modelId":"$modelId"}""")
                    }.status)
                    assertEquals(HttpStatusCode.OK, client.put("/api/sheets/$secondSheetId/model") {
                        jsonBody("""{"modelId":"$modelId"}""")
                    }.status)
                    assertPersistedSheetMetadata(
                        client.get("/api/workbook/bundle").decodeBody(),
                        firstSheet to modelId,
                        secondSheet to modelId,
                    )
                    assertEquals(HttpStatusCode.OK, client.put("/api/data-models/$modelId") {
                        jsonBody(reorderedAndRetypedModelWriteBody("Invoices", "=SUM(unfinished, renamed)"))
                    }.status)
                    assertPersistedSheetMetadata(
                        client.get("/api/workbook/bundle").decodeBody(),
                        firstSheet to modelId,
                        secondSheet to modelId,
                    )
                    assertEquals(HttpStatusCode.OK, client.put("/api/sheets/$firstSheetId/model") {
                        jsonBody("""{"modelId":null}""")
                    }.status)

                    val bundle = client.get("/api/workbook/bundle").decodeBody<WorkbookBundleResponse>()
                    assertPersistedModelMetadata(bundle, modelId, firstSheetId, secondSheetId)
                    assertPersistedSheetMetadata(bundle, firstSheet to null, secondSheet to modelId)
                }
            }

            SqliteWorkbookStore(database).use { store ->
                testApplication {
                    application { module(DefaultWorkbookApplication(store)) }
                    assertPersistedModelMetadata(
                        client.get("/api/workbook/bundle").decodeBody(),
                        modelId,
                        firstSheetId,
                        secondSheetId,
                    )
                    assertPersistedSheetMetadata(
                        client.get("/api/workbook/bundle").decodeBody(),
                        firstSheet to null,
                        secondSheet to modelId,
                    )
                }
            }
        } finally {
            Files.deleteIfExists(database)
            Files.deleteIfExists(database.resolveSibling("${database.fileName}-wal"))
            Files.deleteIfExists(database.resolveSibling("${database.fileName}-shm"))
        }
    }

    @Test
    fun `model declaration edits and sheet bindings persist through HTTP`() = testWorkbookApplication { application ->
        val inputs = client.createSheet()
        val outputs = application.createSheet(CreateSheetCommand("Outputs"))
        val modelId = "30000000-0000-0000-0000-000000000001"

        val created = client.put("/api/data-models/$modelId") {
            jsonBody(modelWriteBody("Quantity", "=SUM(quantity, tax)"))
        }
        val firstBinding = client.put("/api/sheets/${inputs.id}/model") {
            jsonBody("""{"modelId":"$modelId"}""")
        }
        val secondBinding = client.put("/api/sheets/${outputs.id.value}/model") {
            jsonBody("""{"modelId":"$modelId"}""")
        }
        val edited = client.put("/api/data-models/$modelId") {
            jsonBody(modelWriteBody("Units", "=SUM(units, tax)"))
        }

        assertEquals(HttpStatusCode.OK, created.status)
        assertEquals(HttpStatusCode.OK, firstBinding.status)
        assertEquals(HttpStatusCode.OK, secondBinding.status)
        assertEquals(HttpStatusCode.OK, edited.status)
        assertEquals("Units", application.loadWorkbookBundle().dataModels.getValue(modelId).columns.first().name)
        assertEquals("=SUM(units, tax)", application.loadWorkbookBundle().dataModels.getValue(modelId).columns[1].let { (it as CalculatedModelColumn).formula })
        assertEquals(modelId, application.loadSheet(inputs.id).modelId)
        assertEquals(modelId, application.loadSheet(outputs.id.value).modelId)
    }

    @Test
    fun `model binding rejects unknown declarations without changing the sheet`() = testWorkbookApplication { application ->
        val sheet = client.createSheet()

        val response = client.put("/api/sheets/${sheet.id}/model") {
            jsonBody("""{"modelId":"30000000-0000-0000-0000-000000000001"}""")
        }

        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals(ErrorResponse("unknown-data-model"), response.decodeBody())
        assertEquals(null, application.loadSheet(sheet.id).modelId)
    }

    @Test
    fun `model writes reject invalid declarations and allow binding removal`() = testWorkbookApplication { application ->
        val sheet = client.createSheet()
        val modelId = "30000000-0000-0000-0000-000000000001"
        client.put("/api/data-models/$modelId") { jsonBody(modelWriteBody("Quantity", "=SUM(quantity, tax)")) }

        val invalidTypes = listOf(
            modelWriteBody("Quantity", "=SUM(quantity, tax)").replace("\"int\"", "\"decimal\""),
            modelWriteBody("Quantity", "=SUM(quantity, tax)").replace("\"kind\":\"manual\",\"type\":\"int\"", "\"kind\":\"manual\",\"type\":\"int\",\"formula\":\"=1\""),
            modelWriteBody("Quantity", "=SUM(quantity, tax)").replace("\"kind\":\"calculated\"", "\"kind\":\"unknown\""),
            modelWriteBody("Quantity", " "),
            modelWriteBody("Quantity", "=SUM(quantity, tax)").replace("\"name\":\"Invoice\"", "\"name\":\" \""),
            modelWriteBody("Quantity", "=SUM(quantity, tax)").replace("\"name\":\"Tax\"", "\"name\":\"Quantity\""),
            modelWriteBody("Quantity", "=SUM(quantity, tax)").replace("31000000-0000-0000-0000-000000000002", "31000000-0000-0000-0000-000000000001"),
        )

        invalidTypes.forEach { body ->
            val response = client.put("/api/data-models/$modelId") { jsonBody(body) }
            assertEquals(HttpStatusCode.BadRequest, response.status)
            assertEquals(ErrorResponse("invalid-data-model"), response.decodeBody())
        }
        client.put("/api/sheets/${sheet.id}/model") { jsonBody("""{"modelId":"$modelId"}""") }
        val removal = client.put("/api/sheets/${sheet.id}/model") { jsonBody("""{"modelId":null}""") }

        assertEquals(HttpStatusCode.OK, removal.status)
        assertEquals(null, application.loadSheet(sheet.id).modelId)

        val invalidId = client.put("/api/data-models/not-a-uuid") { jsonBody(modelWriteBody("Quantity", "=SUM(quantity, tax)")) }
        assertEquals(HttpStatusCode.BadRequest, invalidId.status)
    }

    @Test
    fun `model write requests retain their metadata`() {
        val column = ModelColumnWriteRequest("column-id", "Amount", "manual", "float")
        val request = DataModelWriteRequest("Invoice", listOf(column))
        val binding = SheetModelWriteRequest("model-id")

        assertEquals(column, column.copy())
        assertEquals("column-id", column.component1())
        assertEquals(request, request.copy())
        assertEquals("Invoice", request.component1())
        assertEquals(binding, binding.copy())
        assertEquals("model-id", binding.component1())
        assertNotEquals(binding, SheetModelWriteRequest())
    }
}

private fun assertPersistedModelMetadata(
    bundle: WorkbookBundleResponse,
    modelId: String,
    unboundSheetId: String,
    boundSheetId: String,
) {
    val model = bundle.dataModels.single()
    assertEquals(modelId, model.id)
    assertEquals("Invoices", model.name)
    assertEquals(
        listOf("Label", "Quantity", "Amount", "Enabled"),
        model.columns.map(ModelColumnResponse::name),
    )
    assertEquals(
        listOf(
            "31000000-0000-0000-0000-000000000001" to ("manual" to "boolean"),
            "31000000-0000-0000-0000-000000000002" to ("manual" to "float"),
            "31000000-0000-0000-0000-000000000003" to ("manual" to "int"),
            "31000000-0000-0000-0000-000000000004" to ("calculated" to "string"),
        ),
        model.columns.map { it.id to (it.kind to it.type) },
    )
    assertEquals("=SUM(unfinished, renamed)", model.columns.last().formula)
    assertEquals(null, bundle.documents.single { it.id == unboundSheetId }.modelId)
    assertEquals(modelId, bundle.documents.single { it.id == boundSheetId }.modelId)
}

private fun assertPersistedSheetMetadata(
    bundle: WorkbookBundleResponse,
    vararg expectedSheets: Pair<SheetDocument, String?>,
) {
    expectedSheets.forEach { (expected, expectedModelId) ->
        val actual = bundle.documents.single { it.id == expected.id.value }
        assertEquals(expectedModelId, actual.modelId)
        assertEquals(expected.name, actual.name)
        assertEquals(expected.frame.position, actual.frame.position)
        assertEquals(expected.frame.size, actual.frame.size)
        assertEquals(expected.frame.visualScale, actual.frame.visualScale)
        assertEquals(expected.frame.zIndex, actual.frame.zIndex)
        assertEquals(expected.presentation.rowHeights, actual.presentation.rowHeights)
        assertEquals(expected.presentation.columnWidths, actual.presentation.columnWidths)
        assertEquals(expected.presentation.formatOverrides, actual.presentation.formatOverrides)
        assertEquals(expected.tabularContent.rows.map(RowId::value), actual.content.rows)
        assertEquals(expected.tabularContent.columns.map(ColumnId::value), actual.content.columns)
        assertEquals(
            expected.tabularContent.cellContents.map { (coordinate, content) ->
                CellContentResponse(coordinate.rowId.value, coordinate.columnId.value, content)
            }.toSet(),
            actual.content.cells.toSet(),
        )
    }
}

private fun shapedZeroRowSheet(): SheetDocument {
    val content = TabularContent(columnCount = 3, rowCount = 0)
    return testDocument(
        TEST_SHEET_1,
        "Inputs",
        FrameState(WorkspacePosition(12.0, 34.0), SheetFrameSize(480.0, 260.0), 1.25, 2),
        content,
    ).copy(
        presentation = SheetPresentation(
            columnWidths = mapOf(content.columns[0].value to 144.0),
            formatOverrides = SheetFormatOverrides(
                columns = mapOf(content.columns[1].value to CellFormat(fontWeight = "bold")),
            ),
        ),
    )
}

private fun shapedSheetWithValuesAndFormula(): SheetDocument {
    val content = TabularContent(
        columnCount = 2,
        rowCount = 2,
        cells = mapOf("A1" to "47", "B1" to "=A1*2", "A2" to "Invoice"),
    )
    return testDocument(
        TEST_SHEET_2,
        "Outputs",
        FrameState(WorkspacePosition(-80.0, 56.0), SheetFrameSize(640.0, 320.0), 0.8, 3),
        content,
    ).copy(
        presentation = SheetPresentation(
            rowHeights = mapOf(content.rows[1].value to 42.0),
            columnWidths = mapOf(content.columns[0].value to 180.0),
            formatOverrides = SheetFormatOverrides(
                rows = mapOf(content.rows[0].value to CellFormat(fillColor = "#aabbcc")),
                cells = mapOf("${content.rows[0].value}\u0000${content.columns[1].value}" to CellFormat(horizontalAlignment = "right")),
            ),
        ),
    )
}

private fun modelWriteBody(firstColumnName: String, formula: String): String = """
    {
      "name":"Invoice",
      "columns":[
        {"id":"31000000-0000-0000-0000-000000000001","name":"$firstColumnName","kind":"manual","type":"int"},
        {"id":"31000000-0000-0000-0000-000000000002","name":"Tax","kind":"calculated","type":"float","formula":"$formula"}
      ]
    }
""".trimIndent()

private fun allTypesModelWriteBody(name: String, formula: String): String = """
    {
      "name":"$name",
      "columns":[
        {"id":"31000000-0000-0000-0000-000000000004","name":"Enabled","kind":"calculated","type":"boolean","formula":"$formula"},
        {"id":"31000000-0000-0000-0000-000000000003","name":"Amount","kind":"manual","type":"float"},
        {"id":"31000000-0000-0000-0000-000000000002","name":"Quantity","kind":"manual","type":"int"},
        {"id":"31000000-0000-0000-0000-000000000001","name":"Label","kind":"manual","type":"string"}
      ]
    }
""".trimIndent()

private fun reorderedAndRetypedModelWriteBody(name: String, formula: String): String = """
    {
      "name":"$name",
      "columns":[
        {"id":"31000000-0000-0000-0000-000000000001","name":"Label","kind":"manual","type":"boolean"},
        {"id":"31000000-0000-0000-0000-000000000002","name":"Quantity","kind":"manual","type":"float"},
        {"id":"31000000-0000-0000-0000-000000000003","name":"Amount","kind":"manual","type":"int"},
        {"id":"31000000-0000-0000-0000-000000000004","name":"Enabled","kind":"calculated","type":"string","formula":"$formula"}
      ]
    }
""".trimIndent()
