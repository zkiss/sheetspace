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

internal suspend fun HttpClient.createSheet(): Sheet {
    val response = post("/api/sheets") {
        jsonBody("""{"name":"Inputs","position":{"x":0.0,"y":0.0}}""")
    }
    assertEquals(HttpStatusCode.Created, response.status)
    return response.decodeBody()
}

internal suspend fun HttpClient.loadWorkbook(): Workbook {
    val summary = get("/api/workbook").decodeBody<WorkbookSummary>()
    return Workbook(
        version = summary.version,
        sheets = summary.sheetIds.map { sheetId -> get("/api/sheets/$sheetId").decodeBody<Sheet>() },
    )
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
