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
        lateinit var firstSheetId: String
        lateinit var secondSheetId: String
        try {
            SqliteWorkbookStore(database).use { store ->
                store.saveWorkbook(
                    testWorkbookOf(
                        testDocument(TEST_SHEET_1, "Inputs"),
                        testDocument(TEST_SHEET_2, "Outputs"),
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
                    assertEquals(HttpStatusCode.OK, client.put("/api/data-models/$modelId") {
                        jsonBody(allTypesModelWriteBody("Invoices", "=SUM(unfinished, renamed)"))
                    }.status)
                    assertEquals(HttpStatusCode.OK, client.put("/api/sheets/$firstSheetId/model") {
                        jsonBody("""{"modelId":null}""")
                    }.status)

                    val bundle = client.get("/api/workbook/bundle").decodeBody<WorkbookBundleResponse>()
                    assertPersistedModelMetadata(bundle, modelId, firstSheetId, secondSheetId)
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
        listOf("Enabled", "Amount", "Quantity", "Label"),
        model.columns.map(ModelColumnResponse::name),
    )
    assertEquals("=SUM(unfinished, renamed)", model.columns.first().formula)
    assertEquals(null, bundle.documents.single { it.id == unboundSheetId }.modelId)
    assertEquals(modelId, bundle.documents.single { it.id == boundSheetId }.modelId)
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
