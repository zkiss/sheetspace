package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class RecordDeletionReplayReceiptTest {
    @Test
    fun `canonical guard retry succeeds while changed replay identity is rejected without writes`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val capture = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
        val deleted = scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, capture)
        val request = RecordReplayRequest(UUID.randomUUID().toString(), "undo", WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
        fun replay(sheet: String, row: String, authority: String, payload: RecordReplayRequest) =
            scenario.app.replayDeletion(sheet, row, authority, payload)
        val committed = replay(scenario.target.id.value, scenario.row.value, deleted.deletionId, request)
        val guard = request.before
        val canonical = request.copy(operationId = request.operationId.uppercase(), before = guard.copy(
            manifest = guard.manifest.copy(sheetIds = guard.manifest.sheetIds.map { it.uppercase() }),
            documents = guard.documents.reversed().map { sheet -> sheet.copy(
                id = sheet.id.uppercase(), content = sheet.content.copy(cells = sheet.content.cells.reversed()),
                modelColumnBindings = sheet.modelColumnBindings.entries.reversed().associate { it.key.uppercase() to it.value.uppercase() },
            ) }, dataModels = guard.dataModels.reversed(),
        ))
        assertEquals(committed.copy(alreadyCommitted = true), replay(scenario.target.id.value.uppercase(), scenario.row.value.uppercase(), deleted.deletionId.uppercase(), canonical))
        val current = store.loadWorkbookBundle()
        val count = replayReceipts(store)
        val changed = listOf(
            request.copy(direction = "redo"),
            request.copy(before = WorkbookReadTransportAdapter.bundle(current)),
            request.copy(before = guard.copy(manifest = guard.manifest.copy(revision = guard.manifest.revision + 1))),
            request.copy(before = guard.copy(documents = guard.documents.map { it.copy(revision = it.revision + 1) })),
            request.copy(before = guard.copy(dataModels = guard.dataModels.map { it.copy(name = "Changed") })),
            request.copy(before = guard.copy(documents = guard.documents.map { it.copy(content = it.content.copy(rows = it.content.rows.reversed())) })),
        )
        changed.forEach { assertInvalid { replay(scenario.target.id.value, scenario.row.value, deleted.deletionId, it) } }
        assertInvalid { replay(scenario.other.id.value, scenario.row.value, deleted.deletionId, request) }
        assertInvalid { replay(scenario.target.id.value, RowId.generate().value, deleted.deletionId, request) }
        assertInvalid { replay(scenario.target.id.value, scenario.row.value, UUID.randomUUID().toString(), request) }
        assertEquals(current, store.loadWorkbookBundle())
        assertEquals(count, replayReceipts(store))
    }

    @Test
    fun `admission provenance cannot authorize deletion and replay receipts share a namespace in both directions`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val initial = store.loadWorkbookBundle()
        val forged = RecordReplayRequest(UUID.randomUUID().toString(), "undo", WorkbookReadTransportAdapter.bundle(initial))
        assertInvalid { scenario.app.replayDeletion(scenario.target.id.value, scenario.row.value, UUID.randomUUID().toString(), forged) }
        assertEquals(initial, store.loadWorkbookBundle())
        assertEquals(0, replayReceipts(store))

        val admission = scenario.replayRequest("undo")
        scenario.replay(admission)
        val afterAdmission = store.loadWorkbookBundle()
        assertInvalid { scenario.app.replayDeletion(scenario.target.id.value, scenario.row.value, UUID.randomUUID().toString(), admission) }
        assertEquals(afterAdmission, store.loadWorkbookBundle())
        assertEquals(1, replayReceipts(store))
        scenario.replay(scenario.replayRequest("redo"))

        val capture = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
        val deleted = scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, capture)
        val deletionReplay = RecordReplayRequest(UUID.randomUUID().toString(), "undo", WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
        assertInvalid { scenario.app.replayDeletion(scenario.target.id.value, scenario.row.value, deleted.deletionId, deletionReplay.copy(operationId = capture.operationId)) }
        scenario.app.replayDeletion(scenario.target.id.value, scenario.row.value, deleted.deletionId, deletionReplay)
        val current = store.loadWorkbookBundle()
        val count = replayReceipts(store)
        assertInvalid { scenario.replay(deletionReplay) }
        assertInvalid { scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, capture.copy(operationId = deletionReplay.operationId)) }
        assertEquals(current, store.loadWorkbookBundle())
        assertEquals(count, replayReceipts(store))
        assertTrue(scenario.app.replayDeletion(scenario.target.id.value, scenario.row.value, deleted.deletionId, deletionReplay).alreadyCommitted)
    }

    private fun assertInvalid(action: () -> Unit) {
        assertEquals(WorkbookApplicationError.INVALID_MODEL_RECORD, assertFailsWith<WorkbookApplicationException>(block = action).error)
    }
}
