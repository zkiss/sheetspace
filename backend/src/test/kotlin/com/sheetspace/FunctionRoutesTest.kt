package com.sheetspace

import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.JsonArray
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FunctionRoutesTest {
    @Test
    fun `receipt response binds operation and reports current workbook on retry`() = testApplication {
        val app = DefaultWorkbookApplication(SqliteWorkbookStore.inMemory())
        application { module(app) }
        val before = WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle())
        val operation = java.util.UUID.randomUUID().toString()
        val request = FunctionWriteRequest(operation, before, CustomFunction("f", emptyList(), "=1"))
        val first = client.put("/api/workbook/functions") { jsonBody(testJson.encodeToString(request)) }.decodeBody<FunctionMutationResponse>()
        assertEquals(operation, first.operationId)
        assertEquals(false, first.alreadyCommitted)
        assertEquals(first.workbook.functions.single().identity, first.committedIdentity)
        app.createSheet(CreateSheetCommand("Later"))
        val retry = client.put("/api/workbook/functions") { jsonBody(testJson.encodeToString(request)) }.decodeBody<FunctionMutationResponse>()
        assertEquals(true, retry.alreadyCommitted)
        assertEquals(first.committedIdentity, retry.committedIdentity)
        assertEquals(WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle()), retry.workbook)
        val mismatch = client.put("/api/workbook/functions") { jsonBody(testJson.encodeToString(request.copy(declaration = request.declaration.copy(body = "=2")))) }
        assertEquals(HttpStatusCode.BadRequest, mismatch.status)
        val malformed = client.put("/api/workbook/functions") { jsonBody(testJson.encodeToString(request.copy(operationId = "bad"))) }
        assertEquals(HttpStatusCode.BadRequest, malformed.status)
        val missing = testJson.encodeToString(request).replace("\"operationId\":\"$operation\",", "")
        assertEquals(HttpStatusCode.BadRequest, client.put("/api/workbook/functions") { jsonBody(missing) }.status)
    }

    @Test
    fun `function request lifecycle commits atomically and survives reopen`() {
        val path = tempSqlitePath()
        try {
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                app.createSheet(CreateSheetCommand("Inputs"))
                testApplication {
                    application { module(app) }
                    val startup = Json.parseToJsonElement(client.get("/api/workbook/bundle").bodyAsText()).jsonObject
                    assertEquals(JsonArray(emptyList()), startup["functions"])
                    val before = WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle())
                    val declaration = CustomFunction("f", emptyList(), "=@A[1]")
                    val create = client.put("/api/workbook/functions") { jsonBody(testJson.encodeToString(FunctionWriteRequest(java.util.UUID.randomUUID().toString(), before, declaration))) }
                    assertEquals(HttpStatusCode.OK, create.status)
                    val created = create.decodeBody<FunctionMutationResponse>().workbook
                    val invalid = client.put("/api/workbook/functions") { jsonBody(testJson.encodeToString(FunctionWriteRequest(java.util.UUID.randomUUID().toString(), created, declaration))) }
                    assertEquals(HttpStatusCode.BadRequest, invalid.status)
                    val stale = client.put("/api/workbook/functions") { jsonBody(testJson.encodeToString(FunctionWriteRequest(java.util.UUID.randomUUID().toString(), before, declaration))) }
                    assertEquals(HttpStatusCode.Conflict, stale.status)
                    val edit = client.put("/api/workbook/functions") { jsonBody(testJson.encodeToString(FunctionWriteRequest(java.util.UUID.randomUUID().toString(), created, declaration.copy(name = "g"), "f"))) }
                    assertEquals(HttpStatusCode.OK, edit.status)
                    val renamed = edit.decodeBody<FunctionMutationResponse>().workbook
                    assertEquals(created.functions.single().bodyBindings, renamed.functions.single().bodyBindings)
                    val deleted = client.post("/api/workbook/functions/delete") { jsonBody(testJson.encodeToString(FunctionDeleteRequest(java.util.UUID.randomUUID().toString(), renamed, "g"))) }
                    assertEquals(HttpStatusCode.OK, deleted.status)
                    assertEquals(JsonArray(emptyList()), Json.parseToJsonElement(deleted.bodyAsText()).jsonObject.getValue("workbook").jsonObject["functions"])
                    assertTrue(deleted.decodeBody<FunctionMutationResponse>().workbook.functions.isEmpty())
                    val sheet = client.post("/api/sheets") { jsonBody("""{"name":"Second"}""") }
                    val creation = Json.parseToJsonElement(sheet.bodyAsText()).jsonObject
                    assertEquals(JsonArray(emptyList()), creation.getValue("workbook").jsonObject["functions"])
                }
            }
            SqliteWorkbookStore(path).use { assertTrue(it.loadWorkbookBundle().functions.isEmpty()) }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }
}
