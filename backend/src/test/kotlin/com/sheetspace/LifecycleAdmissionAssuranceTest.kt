package com.sheetspace

import java.sql.DriverManager
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class LifecycleAdmissionAssuranceTest {
    @Test
    fun `fingerprints normalize operation ids and unordered documents but distinguish semantic changes`() {
        val before = extractionWorkbook()
        val after = extractedFrom(before)
        val operation = UUID.randomUUID().toString()
        fun prepare(id: String, source: WorkbookState, target: WorkbookState) = prepareLifecycleAdmission(
            id, WorkbookReadTransportAdapter.bundle(source), WorkbookReadTransportAdapter.bundle(target),
        )
        val original = prepare(operation, before, after)
        assertEquals(original.operationId, prepare(operation.uppercase(), before, after).operationId)
        val bundle = WorkbookReadTransportAdapter.bundle(before)
        val reordered = prepareLifecycleAdmission(operation, bundle.copy(documents = bundle.documents.reversed()), WorkbookReadTransportAdapter.bundle(after))
        assertEquals(original.fingerprint, reordered.fingerprint)
        assertNotEquals(original.fingerprint, prepare(operation, before, before).fingerprint)
    }

    @Test
    fun `application passes admission through store and returns receipt on retry`() {
        val before = extractionWorkbook()
        val store = InMemoryWorkbookStore(before)
        val app = DefaultWorkbookApplication(store)
        val request = ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(extractedFrom(before)))
        val first = app.saveModelLifecycle(request)
        val retry = app.saveModelLifecycle(request)
        assertEquals(request.operationId, first.operationId)
        assertEquals(first.transitionId, retry.transitionId)
        assertTrue(retry.alreadyCommitted)
        assertEquals(first.workbook, retry.workbook)
    }

    @Test
    fun `capture stores trusted bindings and revisions and rejected admissions preserve durable state`() {
        val path = tempSqlitePath()
        try {
            SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(extractionWorkbook())
                val app = DefaultWorkbookApplication(store)
                val before = app.setFunction(store.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@A[1]"), null)
                val added = DefaultWorkbookApplication(InMemoryWorkbookStore()).createSheet(CreateSheetCommand("New"))
                val existing = before.sheetsInOrder.first()
                val request = request(before, before.replaceSheet(existing.rename("Renamed")).addSheet(added))
                val result = app.saveModelLifecycle(request)
                val captured = transitionEndpoints(path)
                assertEquals(before, captured.first)
                assertEquals(result.workbook.toLifecycleWorkbook(), captured.second)
                assertTrue(captured.second.functions.single().bodyBindings.getValue(added.id.value).contains(added.tabularContent.rows.first().value))
                assertTrue(captured.second.manifest.revision > captured.first.manifest.revision)
                assertTrue(captured.second.documents.getValue(existing.id).revision > captured.first.documents.getValue(existing.id).revision)

                val current = store.loadWorkbookBundle()
                val durable = durableState(path)
                assertFailsWith<WorkbookApplicationException> { app.saveModelLifecycle(request.copy(operationId = UUID.randomUUID().toString())) }
                assertEquals(durable, durableState(path))
                assertEquals(current, store.loadWorkbookBundle())
                assertFailsWith<WorkbookApplicationException> { app.saveModelLifecycle(request.copy(after = request.before)) }
                assertEquals(durable, durableState(path))
                assertEquals(current, store.loadWorkbookBundle())
                val forged = current.copy(functions = current.functions.map { it.copy(bodyBindings = emptyMap()) })
                assertFailsWith<WorkbookApplicationException> { app.saveModelLifecycle(request(current, forged)) }
                assertEquals(durable, durableState(path))
                assertEquals(current, store.loadWorkbookBundle())

                app.saveModelLifecycle(request(current, current.removeSheet(added.id)))
                val removed = store.loadWorkbookBundle()
                val retiredState = durableState(path)
                assertFailsWith<WorkbookApplicationException> { app.saveModelLifecycle(request(removed, removed.addSheet(added))) }
                assertEquals(retiredState, durableState(path))
                assertEquals(removed, store.loadWorkbookBundle())
                assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(removed.addSheet(added)) }
                assertEquals(retiredState, durableState(path))
                assertEquals(removed, store.loadWorkbookBundle())
                assertFailsWith<WorkbookApplicationException> { store.updateWorkbook { removed.addSheet(added) } }
                assertEquals(retiredState, durableState(path))
                assertEquals(removed, store.loadWorkbookBundle())
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }

    private fun request(before: WorkbookState, after: WorkbookState) = ModelLifecycleRequest(
        UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(after),
    )

    private fun transitionEndpoints(path: java.nio.file.Path): Pair<WorkbookState, WorkbookState> =
        DriverManager.getConnection("jdbc:sqlite:${path.toAbsolutePath()}").use { connection ->
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT before_workbook, after_workbook FROM lifecycle_transitions").use { rows ->
                    assertTrue(rows.next())
                    Json.decodeFromString<WorkbookBundleResponse>(rows.getString(1)).toLifecycleWorkbook() to
                        Json.decodeFromString<WorkbookBundleResponse>(rows.getString(2)).toLifecycleWorkbook()
                }
            }
        }

    private fun durableState(path: java.nio.file.Path): List<List<String>> =
        DriverManager.getConnection("jdbc:sqlite:${path.toAbsolutePath()}").use { connection ->
            listOf(
                "SELECT hex(transition_id), before_workbook, after_workbook, applied FROM lifecycle_transitions ORDER BY 1",
                "SELECT hex(operation_id), fingerprint, hex(transition_id) FROM lifecycle_receipts ORDER BY 1",
                "SELECT hex(sheet_id), retired FROM sheet_identity_history ORDER BY 1",
            ).map { sql ->
                connection.createStatement().use { statement ->
                    statement.executeQuery(sql).use { rows ->
                        buildList { while (rows.next()) add((1..rows.metaData.columnCount).joinToString("|") { rows.getString(it) }) }
                    }
                }
            }
        }
}
