package com.sheetspace

import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RecordDeletionRoutesTest {
    @Test
    fun `HTTP captures and replays deletion with authoritative retry state`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val before = store.loadWorkbookBundle()
        val capture = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before))
        testApplication {
            application { module(scenario.app) }
            val path = "/api/sheets/${scenario.target.id.value}/records/${scenario.row.value}/deletions"
            suspend fun postBody(url: String, body: String) = client.post(url) { jsonBody(body) }
            val deletedResponse = postBody(path, Json.encodeToString(capture))
            assertEquals(HttpStatusCode.OK, deletedResponse.status)
            val deleted = deletedResponse.decodeBody<RecordDeletionResult>()
            assertEquals(capture.operationId, deleted.operationId)
            assertEquals(capture.operationId, deleted.deletionId)
            assertEquals(scenario.row.value, deleted.rowId)
            assertFalse(deleted.alreadyCommitted)
            val undo = RecordReplayRequest(UUID.randomUUID().toString(), "undo", deleted.workbook)
            val replayPath = "$path/${deleted.deletionId}/replay"
            val undoResponse = postBody(replayPath, Json.encodeToString(undo))
            assertEquals(HttpStatusCode.OK, undoResponse.status)
            val restored = undoResponse.decodeBody<RecordDeletionReplayResult>()
            assertEquals(undo.operationId, restored.operationId)
            assertEquals(deleted.deletionId, restored.deletionId)
            assertEquals(scenario.row.value, restored.rowId)
            assertTrue(sameWorkbookContent(before, restored.workbook.toLifecycleWorkbook()))
            val captureRetry = postBody(path, Json.encodeToString(capture)).decodeBody<RecordDeletionResult>()
            assertTrue(captureRetry.alreadyCommitted)
            assertEquals(restored.workbook, captureRetry.workbook)
            val redo = RecordReplayRequest(UUID.randomUUID().toString(), "redo", restored.workbook)
            val redone = postBody(replayPath, Json.encodeToString(redo)).decodeBody<RecordDeletionReplayResult>()
            assertTrue(sameWorkbookContent(deleted.workbook.toLifecycleWorkbook(), redone.workbook.toLifecycleWorkbook()))
            val retry = postBody(replayPath, Json.encodeToString(undo)).decodeBody<RecordDeletionReplayResult>()
            assertTrue(retry.alreadyCommitted)
            assertEquals(redone.workbook, retry.workbook)
            assertEquals(store.loadWorkbookBundle(), retry.workbook.toLifecycleWorkbook())
        }
    }

    @Test
    fun `HTTP maps malformed identities directions and stale guards to errors`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val before = store.loadWorkbookBundle()
        val capture = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before))
        testApplication {
            application { module(scenario.app) }
            val path = "/api/sheets/${scenario.target.id.value}/records/${scenario.row.value}/deletions"
            suspend fun submit(url: String, body: String) = client.post(url) { jsonBody(body) }
            assertEquals(ErrorResponse("invalid-request"), submit(path, "{").decodeBody())
            assertEquals(HttpStatusCode.BadRequest, submit(path, Json.encodeToString(capture.copy(operationId = "bad"))).status)
            assertEquals(HttpStatusCode.BadRequest, submit("/api/sheets/bad/records/${scenario.row.value}/deletions", Json.encodeToString(capture)).status)
            val deleted = submit(path, Json.encodeToString(capture)).decodeBody<RecordDeletionResult>()
            val replayPath = "$path/${deleted.deletionId}/replay"
            val undo = RecordReplayRequest(UUID.randomUUID().toString(), "undo", deleted.workbook)
            assertEquals(ErrorResponse("invalid-request"), submit(replayPath, "{}").decodeBody())
            assertEquals(ErrorResponse("invalid-model-record"), submit(replayPath, Json.encodeToString(undo.copy(direction = "forward"))).decodeBody())
            assertEquals(HttpStatusCode.BadRequest, submit("$path/bad/replay", Json.encodeToString(undo)).status)
            val dependency = store.loadSheet(scenario.untouched.id)!!
            scenario.app.writeOneCell(dependency.id.value, "A1", "3", dependency.revision)
            val stale = submit(replayPath, Json.encodeToString(undo))
            assertEquals(HttpStatusCode.Conflict, stale.status)
            assertEquals(ErrorResponse("sheet-revision-conflict", dependency.id.value, dependency.revision, dependency.revision + 1), stale.decodeBody())
            val fresh = undo.copy(before = WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
            val conflict = submit(replayPath, Json.encodeToString(fresh))
            assertEquals(HttpStatusCode.Conflict, conflict.status)
            assertEquals(ErrorResponse("model-lifecycle-conflict", scope = "workbook"), conflict.decodeBody())
        }
    }
}
