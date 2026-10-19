package com.sheetspace

import io.ktor.client.request.put
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class WorkbookModelWriteRoutesTest {
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

private fun modelWriteBody(firstColumnName: String, formula: String): String = """
    {
      "name":"Invoice",
      "columns":[
        {"id":"31000000-0000-0000-0000-000000000001","name":"$firstColumnName","kind":"manual","type":"int"},
        {"id":"31000000-0000-0000-0000-000000000002","name":"Tax","kind":"calculated","type":"float","formula":"$formula"}
      ]
    }
""".trimIndent()
