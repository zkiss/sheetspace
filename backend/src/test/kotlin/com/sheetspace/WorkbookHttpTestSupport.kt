package com.sheetspace

import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.assertEquals

internal val testJson = Json { ignoreUnknownKeys = false }

internal fun testWorkbookApplication(
    block: suspend ApplicationTestBuilder.(StatefulFakeWorkbookApplication) -> Unit,
) = testApplication {
    val workbookApplication = StatefulFakeWorkbookApplication()
    application {
        module(workbookApplication)
    }
    block(workbookApplication)
}

internal data class TestWorkbook(
    val version: Int = WORKBOOK_SCHEMA_VERSION,
    val sheets: List<TestSheet> = emptyList(),
)

internal data class TestSheet(
    val id: String,
    val name: String,
    val revision: Long,
    val position: WorkspacePosition,
    val frameSize: SheetFrameSize,
    val zIndex: Int,
    val columnCount: Int,
    val rowCount: Int,
    val cells: Map<String, String>,
)

internal suspend fun HttpClient.createSheet(): SheetDocumentResponse {
    val response = post("/api/sheets") {
        jsonBody("""{"name":"Inputs","position":{"x":0.0,"y":0.0}}""")
    }
    assertEquals(HttpStatusCode.Created, response.status)
    return response.decodeBody()
}

internal suspend fun HttpClient.loadWorkbook(): TestWorkbook {
    val bundle = get("/api/workbook/bundle").decodeBody<WorkbookBundleResponse>()
    return TestWorkbook(
        version = bundle.manifest.version,
        sheets = bundle.documents.map(SheetDocumentResponse::toTestSheet),
    )
}

internal fun SheetDocumentResponse.toTestSheet(): TestSheet {
    val rows = content.rows.withIndex().associate { (index, id) -> id to index }
    val columns = content.columns.withIndex().associate { (index, id) -> id to index }
    return TestSheet(
        id = id,
        name = name,
        revision = revision,
        position = frame.position,
        frameSize = frame.size,
        zIndex = frame.zIndex,
        rowCount = rows.size,
        columnCount = columns.size,
        cells = content.cells.associate { cell ->
            val columnIndex = columns.getValue(cell.columnId)
            val rowIndex = rows.getValue(cell.rowId)
            testColumnLabel(columnIndex + 1) + (rowIndex + 1) to cell.content
        },
    )
}

private fun testColumnLabel(oneBasedIndex: Int): String {
    var index = oneBasedIndex
    return buildString {
        while (index > 0) {
            index--
            append('A' + index % 26)
            index /= 26
        }
    }.reversed()
}

internal fun HttpRequestBuilder.revisionHeader(
    workbookApplication: WorkbookApplication,
    sheetId: String,
) {
    val revision = workbookApplication.loadSheet(sheetId).revision
    header("If-Match", revision.toString())
}

internal suspend inline fun <reified T> HttpResponse.decodeBody(): T =
    testJson.decodeFromString(bodyAsText())

internal fun HttpRequestBuilder.jsonBody(body: String) {
    contentType(ContentType.Application.Json)
    setBody(body)
}

internal fun HttpRequestBuilder.cellBody(content: String) {
    jsonBody(testJson.encodeToString(content))
}
