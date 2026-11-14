package com.sheetspace

import io.ktor.client.request.put
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class ModelLifecycleSnapshotRoutesTest {
    @Test
    fun `admission retry returns current workbook and rejects operation reuse`() = withSqliteStore { store ->
        val before = extractionWorkbook()
        val after = extractedFrom(before)
        val operation = UUID.randomUUID().toString()
        val request = ModelLifecycleRequest(operation, WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(after))
        store.saveWorkbook(before)
        testApplication {
            application { module(DefaultWorkbookApplication(store)) }
            val first = client.put("/api/workbook/model-lifecycle") { jsonBody(Json.encodeToString(request)) }
            assertEquals(HttpStatusCode.OK, first.status)
            assertEquals(JsonArray(emptyList()), Json.parseToJsonElement(first.bodyAsText()).jsonObject.getValue("workbook").jsonObject["functions"])
            val admitted = first.decodeBody<ModelLifecycleResponse>()
            assertFalse(admitted.alreadyCommitted)
            assertNotEquals(operation, admitted.transitionId)
            val current = store.updateWorkbook { workbook ->
                val source = workbook.documents.getValue(SheetId(EXTRACTION_SOURCE))
                workbook.replaceSheet(source.rename("Independent"))
            }
            val retry = client.put("/api/workbook/model-lifecycle") { jsonBody(Json.encodeToString(request)) }
            val receipt = retry.decodeBody<ModelLifecycleResponse>()
            assertTrue(receipt.alreadyCommitted)
            assertEquals(admitted.transitionId, receipt.transitionId)
            assertEquals(current, receipt.workbook.toLifecycleWorkbook())
            val changed = request.copy(after = request.before)
            val rejected = client.put("/api/workbook/model-lifecycle") { jsonBody(Json.encodeToString(changed)) }
            assertEquals(HttpStatusCode.BadRequest, rejected.status)
            assertEquals(current, store.loadWorkbookBundle())
        }
    }

    @Test
    fun `lifecycle retains server functions and rejects forged bindings over HTTP`() = withSqliteStore { store ->
        val definition = CustomFunction("example", emptyList(), "=@A1", mapOf(EXTRACTION_SOURCE to "=@stable"))
        val before = extractionWorkbook().copy(functions = listOf(definition))
        val after = extractedFrom(before)
        store.saveWorkbook(before)
        testApplication {
            application { module(DefaultWorkbookApplication(store)) }
            val forged = after.copy(functions = listOf(definition.copy(bodyBindings = mapOf(EXTRACTION_SOURCE to "=@forged"))))
            val rejected = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, forged)) }
            assertEquals(HttpStatusCode.BadRequest, rejected.status)
            assertEquals(before, store.loadWorkbookBundle())
            val accepted = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, after)) }
            assertEquals(HttpStatusCode.OK, accepted.status)
            val functions = accepted.decodeBody<ModelLifecycleResponse>().workbook.toLifecycleWorkbook().functions
            assertEquals(definition.bodyBindings.getValue(EXTRACTION_SOURCE), functions.single().bodyBindings.getValue(EXTRACTION_SOURCE))
            assertEquals(functions, store.loadWorkbookBundle().functions)
        }
    }

    @Test
    fun `sheet set snapshots round trip retry undo and redo over HTTP`() {
        val database = tempSqlitePath()
        val before = extractionWorkbook()
        val after = extractedFrom(before)
        lateinit var redone: WorkbookState
        try {
            SqliteWorkbookStore(database).use { store ->
                store.saveWorkbook(before)
                testApplication {
                    application { module(DefaultWorkbookApplication(store)) }
                    val forward = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, after)) }
                    assertEquals(HttpStatusCode.OK, forward.status)
                    val saved = forward.decodeBody<ModelLifecycleResponse>().workbook.toLifecycleWorkbook()
                    assertEquals(semanticSnapshot(after), semanticSnapshot(saved))
                    assertEquals(4, saved.documents.getValue(SheetId(EXTRACTION_OTHER)).frame.zIndex)
                    assertEquals(saved, store.loadWorkbookBundle())
                    assertEquals(before.manifest.revision + 1, saved.manifest.revision)
                    assertEquals(1, saved.documents.getValue(SheetId(EXTRACTION_SOURCE)).revision)
                    assertEquals(1, saved.documents.getValue(SheetId(EXTRACTION_OTHER)).revision)
                    assertEquals(0, saved.documents.getValue(SheetId(EXTRACTION_TARGET)).revision)

                    val retry = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, after)) }
                    assertEquals(HttpStatusCode.OK, retry.status)
                    assertEquals(saved, retry.decodeBody<ModelLifecycleResponse>().workbook.toLifecycleWorkbook())
                    assertEquals(saved, store.loadWorkbookBundle())

                    val stale = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, before)) }
                    assertEquals(HttpStatusCode.Conflict, stale.status)
                    assertEquals(saved, store.loadWorkbookBundle())
                    val invalid = after.replaceSheet(after.documents.getValue(SheetId(EXTRACTION_TARGET)).rename("Source"))
                    val rejected = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(saved, invalid)) }
                    assertEquals(HttpStatusCode.BadRequest, rejected.status)
                    assertEquals(saved, store.loadWorkbookBundle())

                    val inverse = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(saved, before)) }
                    assertEquals(HttpStatusCode.OK, inverse.status)
                    val undone = inverse.decodeBody<ModelLifecycleResponse>().workbook.toLifecycleWorkbook()
                    assertEquals(semanticSnapshot(before), semanticSnapshot(undone))
                    assertEquals(3, undone.documents.getValue(SheetId(EXTRACTION_OTHER)).frame.zIndex)
                    assertEquals(saved.manifest.revision + 1, undone.manifest.revision)
                    assertEquals(undone, store.loadWorkbookBundle())

                    val redo = client.put("/api/workbook/model-lifecycle") {
                        jsonBody(lifecycleBody(undone, withUniformRevision(after, 99)))
                    }
                    assertEquals(HttpStatusCode.BadRequest, redo.status)
                    assertEquals(undone, store.loadWorkbookBundle())
                    redone = undone
                }
            }
            SqliteWorkbookStore(database).use { store -> assertEquals(redone, store.loadWorkbookBundle()) }
        } finally {
            deleteSqliteArtifacts(database)
        }
    }
}
