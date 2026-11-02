package com.sheetspace

import io.ktor.client.request.put
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

class ModelLifecycleSnapshotRoutesTest {
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
                    val saved = forward.decodeBody<WorkbookBundleResponse>().toLifecycleWorkbook()
                    assertEquals(semanticSnapshot(after), semanticSnapshot(saved))
                    assertEquals(saved, store.loadWorkbookBundle())
                    assertEquals(before.manifest.revision + 1, saved.manifest.revision)
                    assertEquals(1, saved.documents.getValue(SheetId(EXTRACTION_SOURCE)).revision)
                    assertEquals(1, saved.documents.getValue(SheetId(EXTRACTION_OTHER)).revision)
                    assertEquals(0, saved.documents.getValue(SheetId(EXTRACTION_TARGET)).revision)

                    val retry = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, after)) }
                    assertEquals(HttpStatusCode.OK, retry.status)
                    assertEquals(saved, retry.decodeBody<WorkbookBundleResponse>().toLifecycleWorkbook())
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
                    val undone = inverse.decodeBody<WorkbookBundleResponse>().toLifecycleWorkbook()
                    assertEquals(semanticSnapshot(before), semanticSnapshot(undone))
                    assertEquals(saved.manifest.revision + 1, undone.manifest.revision)
                    assertEquals(undone, store.loadWorkbookBundle())

                    val redo = client.put("/api/workbook/model-lifecycle") {
                        jsonBody(lifecycleBody(undone, withUniformRevision(after, 99)))
                    }
                    assertEquals(HttpStatusCode.OK, redo.status)
                    redone = redo.decodeBody<WorkbookBundleResponse>().toLifecycleWorkbook()
                    assertEquals(semanticSnapshot(after), semanticSnapshot(redone))
                    assertEquals(undone.manifest.revision + 1, redone.manifest.revision)
                    assertEquals(undone.documents.getValue(SheetId(EXTRACTION_SOURCE)).revision + 1, redone.documents.getValue(SheetId(EXTRACTION_SOURCE)).revision)
                    assertEquals(undone.documents.getValue(SheetId(EXTRACTION_OTHER)).revision + 1, redone.documents.getValue(SheetId(EXTRACTION_OTHER)).revision)
                    assertEquals(0, redone.documents.getValue(SheetId(EXTRACTION_TARGET)).revision)
                    assertEquals(redone, store.loadWorkbookBundle())
                }
            }
            SqliteWorkbookStore(database).use { store -> assertEquals(redone, store.loadWorkbookBundle()) }
        } finally {
            deleteSqliteArtifacts(database)
        }
    }
}
