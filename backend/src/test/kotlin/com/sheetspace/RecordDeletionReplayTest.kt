package com.sheetspace

import java.sql.DriverManager
import java.sql.SQLException
import java.nio.file.Files
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RecordDeletionReplayTest {
    @Test
    fun `captured deletion endpoints replay exactly with distinct authorities and current state receipts`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val before = store.loadWorkbookBundle()
        val other = before.findSheet(scenario.other.id)!!
        val capture = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), listOf(
            RecordRowOrder(other.id.value, other.tabularContent.rows.reversed().map { it.value }),
        ))
        val deleted = scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, capture)
        fun request(direction: String) = RecordReplayRequest(UUID.randomUUID().toString(), direction, WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
        fun replay(id: String, request: RecordReplayRequest) = scenario.app.replayDeletion(scenario.target.id.value, scenario.row.value, id, request)
        val undoRequest = request("undo")
        val undone = replay(deleted.deletionId, undoRequest)
        assertFalse(undone.alreadyCommitted)
        assertTrue(sameWorkbookContent(before, undone.workbook.toLifecycleWorkbook()))
        val afterUndo = store.loadWorkbookBundle()
        val afterDelete = deleted.workbook.toLifecycleWorkbook()
        assertReplayRevisions(afterDelete, afterUndo, scenario)
        val redo = replay(deleted.deletionId, request("redo"))
        assertTrue(sameWorkbookContent(deleted.workbook.toLifecycleWorkbook(), redo.workbook.toLifecycleWorkbook()))
        assertReplayRevisions(afterUndo, store.loadWorkbookBundle(), scenario)
        assertEquals(redo.workbook, replay(deleted.deletionId, undoRequest).workbook)
        assertTrue(replay(deleted.deletionId, undoRequest).alreadyCommitted)
        replay(deleted.deletionId, request("undo"))
        val second = scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, capture.copy(operationId = UUID.randomUUID().toString(), before = WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle())))
        assertTrue(second.deletionId != deleted.deletionId)
        assertEquals(second.workbook, scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, capture).workbook)
        assertEquals(5, replayReceipts(store))
    }

    private fun assertReplayRevisions(before: WorkbookState, after: WorkbookState, scenario: AtomicAdmissionScenario) {
        assertEquals(before.manifest.revision, after.manifest.revision)
        listOf(scenario.target.id, scenario.other.id).forEach { id ->
            assertEquals(before.findSheet(id)!!.revision + 1, after.findSheet(id)!!.revision)
        }
        assertEquals(before.findSheet(scenario.untouched.id)!!.revision, after.findSheet(scenario.untouched.id)!!.revision)
    }

    @Test
    fun `authority guards and operation identity reject forged and stale requests without persistence`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val before = store.loadWorkbookBundle()
        val capture = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before))
        val deleted = scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, capture)
        val current = store.loadWorkbookBundle()
        val request = RecordReplayRequest(UUID.randomUUID().toString(), "undo", WorkbookReadTransportAdapter.bundle(current))
        fun replay(sheet: String, row: String, id: String, req: RecordReplayRequest) = scenario.app.replayDeletion(sheet, row, id, req)
        assertFailsWith<WorkbookApplicationException> { replay(scenario.target.id.value, scenario.row.value, UUID.randomUUID().toString(), request) }
        assertFailsWith<WorkbookApplicationException> { replay(scenario.other.id.value, scenario.row.value, deleted.deletionId, request) }
        assertFailsWith<WorkbookApplicationException> { replay(scenario.target.id.value, UUID.randomUUID().toString(), deleted.deletionId, request) }
        assertFailsWith<WorkbookApplicationException> { replay(scenario.target.id.value, scenario.row.value, deleted.deletionId, request.copy(direction = "redo")) }
        assertFailsWith<WorkbookApplicationException> { replay(scenario.target.id.value, scenario.row.value, deleted.deletionId, request.copy(operationId = capture.operationId)) }
        assertEquals(current, store.loadWorkbookBundle())
        replay(scenario.target.id.value, scenario.row.value, deleted.deletionId, request)
        val restored = store.loadWorkbookBundle()
        assertFailsWith<WorkbookApplicationException> { replay(scenario.target.id.value, scenario.row.value, deleted.deletionId, request.copy(direction = "redo")) }
        assertFailsWith<WorkbookApplicationException> { scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, capture.copy(operationId = request.operationId)) }
        assertEquals(restored, store.loadWorkbookBundle())
    }

    @Test
    fun `fresh guard cannot authorize unrelated changes and stale guards cannot authorize replay`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val capture = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
        val deleted = scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, capture)
        val stale = WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle())
        val sheet = store.loadSheet(scenario.untouched.id)!!
        store.writePresentation(ExpectedSheetRevision(sheet.id.value, sheet.revision), listOf(AxisSizeWrite("row", sheet.tabularContent.rows.first().value, 42.0)))
        val current = store.loadWorkbookBundle()
        fun attempt(guard: WorkbookBundleResponse) = scenario.app.replayDeletion(scenario.target.id.value, scenario.row.value, deleted.deletionId, RecordReplayRequest(UUID.randomUUID().toString(), "undo", guard))
        assertFailsWith<Exception> { attempt(stale) }
        assertFailsWith<WorkbookApplicationException> { attempt(WorkbookReadTransportAdapter.bundle(current)) }
        assertEquals(current, store.loadWorkbookBundle())
        assertEquals(1, replayReceipts(store))
    }

    @Test
    fun `replay receipt survives reopen and target sheet removal`() {
        val directory = Files.createTempDirectory("deletion-replay")
        val path = directory.resolve("workbook.db")
        try {
            lateinit var sheetId: String
            lateinit var rowId: String
            lateinit var deletionId: String
            lateinit var request: RecordReplayRequest
            SqliteWorkbookStore(path).use { store ->
                val scenario = AtomicAdmissionScenario(store)
                scenario.admit()
                sheetId = scenario.target.id.value
                rowId = scenario.row.value
                val capture = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
                deletionId = scenario.app.deleteRecord(sheetId, rowId, capture).deletionId
                request = RecordReplayRequest(UUID.randomUUID().toString(), "undo", WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
                scenario.app.replayDeletion(sheetId, rowId, deletionId, request)
                scenario.app.deleteSheet(sheetId, store.loadSheet(SheetId(sheetId))!!.revision)
            }
            SqliteWorkbookStore(path).use { store ->
                val result = DefaultWorkbookApplication(store).replayDeletion(sheetId, rowId, deletionId, request)
                assertTrue(result.alreadyCommitted)
                assertEquals(WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()), result.workbook)
            }
        } finally {
            path.toFile().delete()
            directory.toFile().delete()
        }
    }

    @Test
    fun `receipt insertion failure rolls replay back atomically`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val capture = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
        val deleted = scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, capture)
        val before = store.loadWorkbookBundle()
        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            connection.createStatement().use { it.execute("CREATE TRIGGER fail_replay BEFORE INSERT ON record_replays BEGIN SELECT RAISE(ABORT, 'test'); END") }
        }
        val request = RecordReplayRequest(UUID.randomUUID().toString(), "undo", WorkbookReadTransportAdapter.bundle(before))
        assertFailsWith<SQLException> { scenario.app.replayDeletion(scenario.target.id.value, scenario.row.value, deleted.deletionId, request) }
        assertEquals(before, store.loadWorkbookBundle())
        assertEquals(1, replayReceipts(store))
    }
}
