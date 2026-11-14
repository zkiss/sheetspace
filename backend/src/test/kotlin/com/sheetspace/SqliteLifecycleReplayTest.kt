package com.sheetspace

import java.util.UUID
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SqliteLifecycleReplayTest {
    private fun id() = UUID.randomUUID().toString()

    @Test
    fun `later function creation and edits survive extraction replay`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val initial = extractionWorkbook()
            store.saveWorkbook(initial)
            val app = DefaultWorkbookApplication(store)
            val before = app.setFunction(store.loadWorkbookBundle(), CustomFunction("edited", emptyList(), "=1"), null)
            val admitted = app.saveModelLifecycle(ModelLifecycleRequest(id(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(extractedFrom(before))))
            val changed = app.setFunction(store.loadWorkbookBundle(), CustomFunction("edited", emptyList(), "=2"), "edited")
            val current = app.setFunction(changed, CustomFunction("created", emptyList(), "=3"), null)
            val targetId = SheetId(EXTRACTION_TARGET)
            val undone = app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(id(), "undo")).workbook.toLifecycleWorkbook()
            assertEquals(listOf("=2", "=3"), undone.functions.map { it.body })
            assertTrue(undone.functions.all { targetId.value !in it.bodyBindings })
            val redone = app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(id(), "redo")).workbook.toLifecycleWorkbook()
            assertEquals(current.functions, redone.functions)
            val again = app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(id(), "undo")).workbook.toLifecycleWorkbook()
            assertEquals(undone.functions, again.functions)
        }
    }

    @Test
    fun `replay restores captured bindings while ordinary resurrection is rejected`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val before = app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[1]"), null)
            val binding = before.functions.single().bodyBindings.getValue(caller.id.value)
            val request = ModelLifecycleRequest(id(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(target.id)))
            val deletion = app.saveModelLifecycle(request)
            val removed = store.loadWorkbookBundle()
            assertEquals(binding, removed.functions.single().bodyBindings.getValue(caller.id.value))
            assertFailsWith<WorkbookApplicationException> {
                app.saveModelLifecycle(ModelLifecycleRequest(id(), WorkbookReadTransportAdapter.bundle(removed), WorkbookReadTransportAdapter.bundle(removed.addSheet(target))))
            }
            val restored = app.replayLifecycle(deletion.transitionId, LifecycleReplayRequest(id(), "undo")).workbook.toLifecycleWorkbook()
            assertEquals(target.tabularContent, restored.documents.getValue(target.id).tabularContent)
            assertEquals(before.functions, restored.functions)
            app.replayLifecycle(deletion.transitionId, LifecycleReplayRequest(id(), "redo"))
            val again = app.replayLifecycle(deletion.transitionId, LifecycleReplayRequest(id(), "undo")).workbook.toLifecycleWorkbook()
            assertEquals(before.functions, again.functions)
        }
    }

    @Test
    fun `captured extraction replays across reopen with durable receipts and exact identities`() {
        val path = tempSqlitePath()
        try {
            val before = extractionWorkbook()
            val after = extractedFrom(before)
            val operation = id()
            val admission = SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(before)
                DefaultWorkbookApplication(store).saveModelLifecycle(ModelLifecycleRequest(operation, WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(after)))
            }
            val undo = LifecycleReplayRequest(id(), "undo")
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                val undone = app.replayLifecycle(admission.transitionId, undo)
                assertFalse(undone.alreadyCommitted)
                assertTrue(sameWorkbookContent(before, undone.workbook.toLifecycleWorkbook()))
                val redo = app.replayLifecycle(admission.transitionId, LifecycleReplayRequest(id(), "redo"))
                assertTrue(sameWorkbookContent(admission.workbook.toLifecycleWorkbook(), redo.workbook.toLifecycleWorkbook()))
                val retry = app.replayLifecycle(admission.transitionId, undo)
                assertTrue(retry.alreadyCommitted)
                assertEquals(redo.workbook, retry.workbook)
                assertTrue(app.saveModelLifecycle(ModelLifecycleRequest(operation, WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(after))).alreadyCommitted)
                assertFailsWith<WorkbookApplicationException> { app.replayLifecycle(admission.transitionId, undo.copy(direction = "redo")) }
                assertFailsWith<WorkbookApplicationException> { app.replayLifecycle(id(), LifecycleReplayRequest(id(), "undo")) }
                assertFailsWith<WorkbookApplicationException> { app.replayLifecycle(admission.transitionId, LifecycleReplayRequest(id(), "redo")) }
                assertEquals(redo.workbook, WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
                app.replayLifecycle(admission.transitionId, LifecycleReplayRequest(id(), "undo"))
                app.replayLifecycle(admission.transitionId, LifecycleReplayRequest(id(), "redo"))
                assertTrue(sameWorkbookContent(admission.workbook.toLifecycleWorkbook(), store.loadWorkbookBundle()))
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }

    @Test
    fun `independent edits survive replay and overlapping edits reject without consuming operation`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val original = extractionWorkbook()
            store.saveWorkbook(original)
            val app = DefaultWorkbookApplication(store)
            val before = store.loadWorkbookBundle()
            val admitted = app.saveModelLifecycle(ModelLifecycleRequest(id(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(extractedFrom(before))))
            val edited = store.loadWorkbookBundle()
            val other = edited.documents.getValue(SheetId(EXTRACTION_OTHER))
            val altered = edited.replaceSheet(other.rename("Other edited"))
            store.updateWorkbook { altered }
            val undo = LifecycleReplayRequest(id(), "undo")
            val undone = app.replayLifecycle(admitted.transitionId, undo).workbook.toLifecycleWorkbook()
            assertEquals("Other edited", undone.documents.getValue(other.id).name)
            app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(id(), "redo"))
            val current = store.loadWorkbookBundle()
            val target = current.documents.getValue(SheetId(EXTRACTION_TARGET))
            store.updateWorkbook { current.replaceSheet(target.rename("Conflict")) }
            val conflict = store.loadWorkbookBundle()
            val operation = LifecycleReplayRequest(id(), "undo")
            assertEquals(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT, assertFailsWith<WorkbookApplicationException> { app.replayLifecycle(admitted.transitionId, operation) }.error)
            assertEquals(conflict, store.loadWorkbookBundle())
            store.updateWorkbook { current }
            assertFalse(app.replayLifecycle(admitted.transitionId, operation).alreadyCommitted)
        }
    }

    @Test
    fun `http replay exposes authority and rejects missing or unknown authority`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val before = extractionWorkbook()
            store.saveWorkbook(before)
            testApplication {
                application { module(DefaultWorkbookApplication(store)) }
                val request = ModelLifecycleRequest(id(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(extractedFrom(before)))
                val admitted = client.put("/api/workbook/model-lifecycle") { jsonBody(Json.encodeToString(request)) }.decodeBody<ModelLifecycleResponse>()
                val replay = LifecycleReplayRequest(id(), "undo")
                val path = "/api/workbook/model-lifecycle/${admitted.transitionId}/replay"
                val response = client.post(path) { jsonBody(Json.encodeToString(replay)) }
                assertEquals(HttpStatusCode.OK, response.status)
                assertEquals(admitted.transitionId, response.decodeBody<ModelLifecycleResponse>().transitionId)
                assertTrue(client.post(path) { jsonBody(Json.encodeToString(replay)) }.decodeBody<ModelLifecycleResponse>().alreadyCommitted)
                assertEquals(HttpStatusCode.BadRequest, client.post("/api/workbook/model-lifecycle/${id()}/replay") { jsonBody(Json.encodeToString(replay.copy(operationId = id()))) }.status)
                for (body in listOf("{}", "{", "{\"operationId\":\"${id()}\"}")) {
                    val invalid = client.post(path) { jsonBody(body) }
                    assertEquals(HttpStatusCode.BadRequest, invalid.status)
                    assertEquals(ErrorResponse("invalid-model-lifecycle"), invalid.decodeBody<ErrorResponse>())
                }
                for (body in listOf("{}", "{", "{\"operationId\":\"${id()}\"}")) {
                    val invalid = client.put("/api/workbook/model-lifecycle") { jsonBody(body) }
                    assertEquals(HttpStatusCode.BadRequest, invalid.status)
                    assertEquals(ErrorResponse("invalid-model-lifecycle"), invalid.decodeBody<ErrorResponse>())
                }
            }
        }
    }

    @Test
    fun `restoration conflicting with a later sheet name returns conflict without consuming receipt`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val removed = app.createSheet(CreateSheetCommand("Removed"))
            val survivor = app.createSheet(CreateSheetCommand("Survivor"))
            val before = store.loadWorkbookBundle()
            val admitted = app.saveModelLifecycle(ModelLifecycleRequest(id(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(removed.id))))
            val current = store.loadWorkbookBundle()
            store.updateWorkbook { current.replaceSheet(current.documents.getValue(survivor.id).rename("Removed")) }
            val conflicting = store.loadWorkbookBundle()
            val replay = LifecycleReplayRequest(id(), "undo")
            testApplication {
                application { module(app) }
                val path = "/api/workbook/model-lifecycle/${admitted.transitionId}/replay"
                val response = client.post(path) { jsonBody(Json.encodeToString(replay)) }
                assertEquals(HttpStatusCode.Conflict, response.status)
                assertEquals(ErrorResponse("model-lifecycle-conflict", scope = "workbook"), response.decodeBody<ErrorResponse>())
                assertEquals(conflicting, store.loadWorkbookBundle())
                store.updateWorkbook { current }
                val success = client.post(path) { jsonBody(Json.encodeToString(replay)) }
                assertEquals(HttpStatusCode.OK, success.status)
                assertFalse(success.decodeBody<ModelLifecycleResponse>().alreadyCommitted)
                assertTrue(store.loadWorkbookBundle().documents.containsKey(removed.id))
            }
        }
    }

    @Test
    fun `removing an axis with a later cell conflicts and leaves replay retryable`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val sheet = app.createSheet(CreateSheetCommand("Inputs"))
            val before = store.loadWorkbookBundle()
            val content = sheet.tabularContent
            val addedRow = RowId.generate()
            val expanded = sheet.copy(content = TabularContent(content.rows + addedRow, content.columns, content.cellContents))
            val admitted = app.saveModelLifecycle(ModelLifecycleRequest(id(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.replaceSheet(expanded))))
            val current = store.loadWorkbookBundle()
            val expandedSheet = current.documents.getValue(sheet.id)
            val expandedContent = expandedSheet.tabularContent
            val cell = CellCoordinate(addedRow, expandedContent.columns.first())
            store.updateWorkbook { current.replaceSheet(expandedSheet.copy(content = TabularContent(expandedContent.rows, expandedContent.columns, expandedContent.cellContents + (cell to "later")))) }
            val conflicting = store.loadWorkbookBundle()
            val replay = LifecycleReplayRequest(id(), "undo")
            testApplication {
                application { module(app) }
                val path = "/api/workbook/model-lifecycle/${admitted.transitionId}/replay"
                val failure = client.post(path) { jsonBody(Json.encodeToString(replay)) }
                assertEquals(HttpStatusCode.Conflict, failure.status)
                assertEquals(ErrorResponse("model-lifecycle-conflict", scope = "workbook"), failure.decodeBody<ErrorResponse>())
                assertEquals(conflicting, store.loadWorkbookBundle())
                store.updateWorkbook { current }
                val success = client.post(path) { jsonBody(Json.encodeToString(replay)) }.decodeBody<ModelLifecycleResponse>()
                assertFalse(success.alreadyCommitted)
                val saved = store.loadWorkbookBundle()
                assertTrue(client.post(path) { jsonBody(Json.encodeToString(replay)) }.decodeBody<ModelLifecycleResponse>().alreadyCommitted)
                assertEquals(saved, store.loadWorkbookBundle())
            }
        }
    }

    @Test
    fun `row and column removals in either replay direction reject later cells`() {
        for (removeRow in listOf(true, false)) {
            for (direction in listOf("undo", "redo")) {
                SqliteWorkbookStore.inMemory().use { store ->
                    val app = DefaultWorkbookApplication(store)
                    val sheet = app.createSheet(CreateSheetCommand("Inputs"))
                    val before = store.loadWorkbookBundle()
                    val content = sheet.tabularContent
                    val row = if (removeRow) RowId.generate() else content.rows.first()
                    val column = if (removeRow) content.columns.first() else ColumnId.generate()
                    val expanded = sheet.copy(content = TabularContent(
                        if (removeRow) content.rows + row else content.rows,
                        if (removeRow) content.columns else content.columns + column,
                        content.cellContents,
                    ))
                    if (direction == "redo") store.updateWorkbook { before.replaceSheet(expanded) }
                    val source = store.loadWorkbookBundle()
                    val target = if (direction == "undo") source.replaceSheet(expanded) else source.replaceSheet(sheet)
                    val admitted = app.saveModelLifecycle(ModelLifecycleRequest(id(), WorkbookReadTransportAdapter.bundle(source), WorkbookReadTransportAdapter.bundle(target)))
                    if (direction == "redo") app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(id(), "undo"))
                    val current = store.loadWorkbookBundle()
                    val currentSheet = current.documents.getValue(sheet.id)
                    val currentContent = currentSheet.tabularContent
                    store.updateWorkbook { current.replaceSheet(currentSheet.copy(content = TabularContent(currentContent.rows, currentContent.columns, currentContent.cellContents + (CellCoordinate(row, column) to "later")))) }
                    val conflicting = store.loadWorkbookBundle()
                    val error = assertFailsWith<WorkbookApplicationException> { app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(id(), direction)) }
                    assertEquals(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT, error.error)
                    assertEquals(conflicting, store.loadWorkbookBundle())
                }
            }
        }
    }
}
