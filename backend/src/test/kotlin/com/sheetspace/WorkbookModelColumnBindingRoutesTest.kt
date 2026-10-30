package com.sheetspace

import io.ktor.client.request.put
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals

class WorkbookModelColumnBindingRoutesTest {
    private val modelId = "30000000-0000-0000-0000-000000000001"
    private val revenueId = "31000000-0000-0000-0000-000000000001"
    private val costId = "31000000-0000-0000-0000-000000000002"
    private val unknownId = "31000000-0000-0000-0000-000000000003"

    @Test
    fun `explicit association requests round trip stable property and column identities`() = testWorkbookApplication { application ->
        val sheet = client.createSheet()
        application.saveDataModel(model())
        val columnId = sheet.content.columns[1]

        val response = client.put("/api/sheets/${sheet.id}/model") {
            jsonBody("""{"modelId":"$modelId","modelColumnBindings":{"$revenueId":"$columnId"}}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(mapOf(revenueId to columnId), response.decodeBody<SheetDocumentResponse>().modelColumnBindings)
        assertEquals(mapOf(revenueId to ColumnId(columnId)), application.loadSheet(sheet.id).modelColumnBindings)
        val unbound = client.put("/api/sheets/${sheet.id}/model") { jsonBody("""{"modelId":null}""") }
        assertEquals(emptyMap(), unbound.decodeBody<SheetDocumentResponse>().modelColumnBindings)
    }

    @Test
    fun `invalid association requests leave all stored metadata unchanged`() = testWorkbookApplication { application ->
        val sheet = client.createSheet()
        application.saveDataModel(model())
        val columnId = sheet.content.columns[0]
        client.put("/api/sheets/${sheet.id}/model") { jsonBody("""{"modelId":"$modelId"}""") }
        val before = application.loadWorkbookBundle()
        val requests = listOf(
            """{"modelId":"$modelId","modelColumnBindings":{"$unknownId":"$columnId"}}""",
            """{"modelId":"$modelId","modelColumnBindings":{"$revenueId":"$unknownId"}}""",
            """{"modelId":"$modelId","modelColumnBindings":{"$revenueId":"$columnId","$costId":"$columnId"}}""",
            """{"modelId":null,"modelColumnBindings":{"$revenueId":"$columnId"}}""",
        )

        requests.forEach { request ->
            val response = client.put("/api/sheets/${sheet.id}/model") { jsonBody(request) }

            assertEquals(HttpStatusCode.BadRequest, response.status)
            assertEquals(ErrorResponse("invalid-data-model"), response.decodeBody())
            assertEquals(before, application.loadWorkbookBundle())
        }
    }

    @Test
    fun `attachment rejects named bound identities and collisions without changing stored workbook`() = testWorkbookApplication { application ->
        val sheet = client.createSheet()
        application.saveDataModel(model())
        val beforeNaming = application.loadWorkbookBundle()
        val document = beforeNaming.documents.getValue(SheetId(sheet.id))
        val named = document.copy(columnNames = mapOf(sheet.content.columns[0] to "Revenue"))
        application.saveModelLifecycle(beforeNaming, beforeNaming.replaceSheet(named))
        val before = application.loadWorkbookBundle()

        listOf(sheet.content.columns[0], sheet.content.columns[1]).forEach { column ->
            val response = client.put("/api/sheets/${sheet.id}/model") {
                jsonBody("""{"modelId":"$modelId","modelColumnBindings":{"$revenueId":"$column"}}""")
            }
            assertEquals(HttpStatusCode.BadRequest, response.status)
            assertEquals(before, application.loadWorkbookBundle())
        }
        val accepted = client.put("/api/sheets/${sheet.id}/model") {
            jsonBody("""{"modelId":"$modelId","modelColumnBindings":{"$costId":"${sheet.content.columns[1]}"}}""")
        }
        assertEquals(HttpStatusCode.OK, accepted.status)
    }

    @Test
    fun `model declaration collision on a bound sheet is rejected atomically`() = testWorkbookApplication { application ->
        val sheet = client.createSheet()
        application.saveDataModel(model())
        client.put("/api/sheets/${sheet.id}/model") {
            jsonBody("""{"modelId":"$modelId","modelColumnBindings":{"$revenueId":"${sheet.content.columns[0]}"}}""")
        }
        val beforeNaming = application.loadWorkbookBundle()
        val document = beforeNaming.documents.getValue(SheetId(sheet.id))
        application.saveModelLifecycle(beforeNaming, beforeNaming.replaceSheet(document.copy(columnNames = mapOf(sheet.content.columns[1] to "Local"))))
        val before = application.loadWorkbookBundle()

        val response = client.put("/api/data-models/$modelId") {
            jsonBody("""{"name":"Budget","columns":[{"id":"$revenueId","name":"Local","kind":"manual","type":"float"},{"id":"$costId","name":"Cost","kind":"manual","type":"float"}]}""")
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals(before, application.loadWorkbookBundle())
    }

    private fun model() = DataModel(modelId, "Budget", listOf(
        ManualModelColumn(revenueId, "Revenue", ModelColumnType.FLOAT),
        ManualModelColumn(costId, "Cost", ModelColumnType.FLOAT),
    ))
}
