package com.sheetspace

import java.nio.file.Files
import java.sql.SQLException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RecordReplayReceiptTest {
    @Test
    fun `same operation identity rejects changed direction path guard and revisions before checking mutable state`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val request = scenario.replayRequest("undo")
        scenario.replay(request)
        val before = request.before
        val changed = listOf(
            request.copy(direction = "redo"),
            request.copy(before = WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle())),
            request.copy(before = before.copy(manifest = before.manifest.copy(revision = before.manifest.revision + 1))),
            request.copy(before = before.copy(documents = before.documents.map { it.copy(revision = it.revision + 1) })),
            request.copy(before = before.copy(dataModels = before.dataModels.map { it.copy(name = "Changed") })),
        )
        val current = store.loadWorkbookBundle()
        changed.forEach { altered -> assertInvalid { scenario.replay(altered) } }
        assertInvalid { scenario.app.replayRecord(scenario.other.id.value, scenario.row.value, request) }
        assertInvalid { scenario.app.replayRecord(scenario.target.id.value, RowId.generate().value, request) }
        assertEquals(current, store.loadWorkbookBundle())
        assertEquals(1, replayReceipts(store))
    }

    @Test
    fun `canonical identity and unordered guard collections confirm the same receipt but ordered axes do not`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val request = scenario.replayRequest("undo")
        val committed = scenario.replay(request)
        val guard = request.before
        val normalized = request.copy(operationId = request.operationId.uppercase(), before = guard.copy(
            manifest = guard.manifest.copy(sheetIds = guard.manifest.sheetIds.map { it.uppercase() }),
            documents = guard.documents.reversed().map { sheet -> sheet.copy(
                id = sheet.id.uppercase(),
                content = sheet.content.copy(cells = sheet.content.cells.reversed()),
                modelColumnBindings = sheet.modelColumnBindings.entries.reversed().associate { it.key.uppercase() to it.value.uppercase() },
            ) },
            dataModels = guard.dataModels.reversed(),
        ))
        val retried = scenario.app.replayRecord(scenario.target.id.value.uppercase(), scenario.row.value.uppercase(), normalized)
        assertEquals(committed.copy(alreadyCommitted = true), retried)
        assertInvalid { scenario.replay(request.copy(before = guard.copy(documents = guard.documents.map { sheet -> sheet.copy(content = sheet.content.copy(rows = sheet.content.rows.reversed())) }))) }
    }

    @Test
    fun `durable provenance and replay receipts survive store reopen and later inverse operations`() {
        val directory = Files.createTempDirectory("record-replay")
        val path = directory.resolve("workbook.db")
        try {
            lateinit var undo: RecordReplayRequest
            lateinit var redo: RecordReplayRequest
            lateinit var rowId: String
            lateinit var target: SheetDocument
            lateinit var admission: RecordAdmissionRequest
            SqliteWorkbookStore(path).use { store ->
                val scenario = AtomicAdmissionScenario(store)
                rowId = scenario.row.value
                target = scenario.target
                admission = scenario.request
                scenario.admit()
                undo = scenario.replayRequest("undo")
                scenario.replay(undo)
            }
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                val current = store.loadWorkbookBundle()
                assertEquals(RecordReplayResult(undo.operationId, rowId, true, WorkbookReadTransportAdapter.bundle(current)), app.replayRecord(target.id.value, rowId, undo))
                assertEquals(current, app.admitRecord(target.id.value, target.revision, rowId, admission.values, admission.before, admission.rowOrders).workbook)
                redo = RecordReplayRequest(java.util.UUID.randomUUID().toString(), "redo", WorkbookReadTransportAdapter.bundle(current))
                assertFalse(app.replayRecord(target.id.value, rowId, redo).alreadyCommitted)
            }
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                assertTrue(app.replayRecord(target.id.value, rowId, redo).alreadyCommitted)
                assertTrue(RowId(rowId) in store.loadSheet(target.id)!!.tabularContent.rows)
                assertEquals(store.loadWorkbookBundle(), app.replayRecord(target.id.value, rowId, undo).workbook.toLifecycleWorkbook())
                assertEquals(2, replayReceipts(store))
            }
        } finally {
            directory.toFile().deleteRecursively()
        }
    }

    @Test
    fun `receipt insertion failure rolls back all row order and revision writes in both directions`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        listOf("undo", "redo").forEach { direction ->
            val before = store.loadWorkbookBundle()
            val count = replayReceipts(store)
            val request = scenario.replayRequest(direction)
            admissionSql(store, "CREATE TRIGGER fail_replay BEFORE INSERT ON record_replays BEGIN SELECT RAISE(ABORT, 'receipt failure'); END")
            assertFailsWith<SQLException> { scenario.replay(request) }
            assertEquals(before, store.loadWorkbookBundle())
            assertEquals(count, replayReceipts(store))
            admissionSql(store, "DROP TRIGGER fail_replay")
            assertFalse(scenario.replay(request).alreadyCommitted)
            assertEquals(count + 1, replayReceipts(store))
        }
    }

    @Test
    fun `failed original admission cannot leave orphan restoration authority`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        admissionSql(store, "CREATE TRIGGER fail_provenance BEFORE INSERT ON record_admissions BEGIN SELECT RAISE(ABORT, 'provenance failure'); END")
        assertFailsWith<SQLException> { scenario.admit() }
        assertEquals(scenario.before, store.loadWorkbookBundle())
        assertInvalid { scenario.replay(scenario.replayRequest("redo")) }
        assertEquals(0, replayReceipts(store))
        assertEquals(0, admissionReceipts(store))
        admissionSql(store, "DROP TRIGGER fail_provenance")
        scenario.admit()
        assertFalse(scenario.replay(scenario.replayRequest("undo")).alreadyCommitted)
    }

    private fun assertInvalid(action: () -> Unit) {
        assertEquals(WorkbookApplicationError.INVALID_MODEL_RECORD, assertFailsWith<WorkbookApplicationException>(block = action).error)
    }
}
