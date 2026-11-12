package com.sheetspace

import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RecordReplayRoutesTest {
    @Test
    fun `HTTP replays both directions and confirms frozen retries after later deletion without preflight`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        testApplication {
            application { module(scenario.app) }
            suspend fun submit(request: RecordReplayRequest, extra: String = "") = client.post("/api/sheets/${scenario.target.id.value}/records/${scenario.row.value}/replay") {
                val body = Json.encodeToString(request)
                jsonBody(if (extra.isEmpty()) body else body.dropLast(1) + extra + "}")
            }
            val undo = scenario.replayRequest("undo")
            val removed = submit(undo, """, "after": {"untrusted": "ignored"}, "rowOrders": []""")
            assertEquals(HttpStatusCode.OK, removed.status)
            val result = removed.decodeBody<RecordReplayResult>()
            assertFalse(result.alreadyCommitted)
            assertEquals(undo.operationId, result.operationId)
            assertEquals(scenario.row.value, result.rowId)
            assertEquals(store.loadWorkbookBundle(), result.workbook.toLifecycleWorkbook())
            assertEquals(3, result.workbook.documents.size)
            assertEquals(result.copy(alreadyCommitted = true), submit(undo).decodeBody<RecordReplayResult>())
            val redo = scenario.replayRequest("redo")
            val restored = submit(redo)
            assertEquals(HttpStatusCode.OK, restored.status)
            assertTrue(RowId(scenario.row.value) in restored.decodeBody<RecordReplayResult>().workbook.toLifecycleWorkbook().documents.getValue(scenario.target.id).tabularContent.rows)
            val changed = submit(redo.copy(direction = "undo"))
            assertEquals(HttpStatusCode.BadRequest, changed.status)
            assertEquals(ErrorResponse("invalid-model-record"), changed.decodeBody())
            scenario.app.deleteSheet(scenario.target.id.value, store.loadSheet(scenario.target.id)!!.revision)
            val retry = submit(redo).decodeBody<RecordReplayResult>()
            assertTrue(retry.alreadyCommitted)
            assertEquals(2, retry.workbook.documents.size)
            assertEquals(store.loadWorkbookBundle(), retry.workbook.toLifecycleWorkbook())
        }
    }

    @Test
    fun `HTTP reports contextual revision missing dependency and workbook source conflicts`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        testApplication {
            application { module(scenario.app) }
            suspend fun submit(request: RecordReplayRequest) = client.post("/api/sheets/${scenario.target.id.value}/records/${scenario.row.value}/replay") { jsonBody(Json.encodeToString(request)) }
            val stale = scenario.replayRequest("undo")
            val dependency = scenario.untouched
            scenario.app.writeOneCell(dependency.id.value, "A1", "3", dependency.revision)
            val conflict = submit(stale)
            assertEquals(HttpStatusCode.Conflict, conflict.status)
            assertEquals(ErrorResponse("sheet-revision-conflict", dependency.id.value, dependency.revision, dependency.revision + 1), conflict.decodeBody())
            val semantic = submit(scenario.replayRequest("undo"))
            assertEquals(HttpStatusCode.Conflict, semantic.status)
            assertEquals(ErrorResponse("model-lifecycle-conflict", scope = "workbook"), semantic.decodeBody())
            val missingGuard = scenario.replayRequest("undo")
            scenario.app.deleteSheet(dependency.id.value, dependency.revision + 1)
            val missing = submit(missingGuard)
            assertEquals(HttpStatusCode.NotFound, missing.status)
            assertEquals(ErrorResponse("sheet-not-found", sheetId = dependency.id.value), missing.decodeBody())
            assertEquals(0, replayReceipts(store))
        }
    }

    @Test
    fun `HTTP rejects malformed requests invalid identities and unknown provenance without mutation`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val request = scenario.replayRequest("redo")
        testApplication {
            application { module(scenario.app) }
            val bodies = listOf(
                "{}",
                Json.encodeToString(request),
                Json.encodeToString(request.copy(operationId = "bad")),
                Json.encodeToString(request.copy(direction = "forward")),
                Json.encodeToString(request.copy(before = request.before.copy(documents = request.before.documents.map { it.copy(id = "bad") }))),
                Json.encodeToString(request.copy(before = request.before.copy(documents = request.before.documents + request.before.documents.first()))),
            )
            bodies.forEach { body ->
                val response = client.post("/api/sheets/${scenario.target.id.value}/records/${scenario.row.value}/replay") { jsonBody(body) }
                assertEquals(HttpStatusCode.BadRequest, response.status)
                assertEquals(scenario.before, store.loadWorkbookBundle())
                assertEquals(0, replayReceipts(store))
            }
            listOf("bad/records/${scenario.row.value}", "${scenario.target.id.value}/records/bad").forEach { path ->
                val response = client.post("/api/sheets/$path/replay") { jsonBody(Json.encodeToString(request)) }
                assertEquals(HttpStatusCode.BadRequest, response.status)
                assertEquals(ErrorResponse("invalid-model-record"), response.decodeBody())
            }
        }
    }
}
