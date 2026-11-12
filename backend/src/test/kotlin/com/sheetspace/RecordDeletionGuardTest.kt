package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class RecordDeletionGuardTest {
    @Test
    fun `guards reject changed content and stale sheet revisions without writes`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val before = store.loadWorkbookBundle()
        val guard = WorkbookReadTransportAdapter.bundle(before)
        val request = RecordDeletionRequest(UUID.randomUUID().toString(), guard)
        val row = scenario.target.tabularContent.rows.first().value
        val changedContent = guard.copy(documents = guard.documents.map { if (it.id == scenario.target.id.value) it.copy(name = "changed") else it })
        val staleRevision = guard.copy(documents = guard.documents.map { if (it.id == scenario.other.id.value) it.copy(revision = it.revision + 1) else it })
        listOf(changedContent, staleRevision).forEach { altered ->
            assertFailsWith<RuntimeException> { scenario.app.deleteRecord(scenario.target.id.value, row, request.copy(before = altered)) }
        }
        assertEquals(before, store.loadWorkbookBundle())
        assertEquals(0, replayReceipts(store))
    }

    @Test
    fun `missing and unbound targets and invalid permutations are rejected`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val before = store.loadWorkbookBundle()
        val request = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before))
        val row = scenario.target.tabularContent.rows.first().value
        assertFailsWith<WorkbookApplicationException> { scenario.app.deleteRecord(SheetId.generate().value, row, request) }
        assertFailsWith<WorkbookApplicationException> { scenario.app.deleteRecord(scenario.untouched.id.value, row, request) }
        val rows = scenario.other.tabularContent.rows.map { it.value }
        listOf(
            RecordRowOrder(SheetId.generate().value, rows),
            RecordRowOrder(scenario.other.id.value, List(rows.size) { rows.first() }),
            RecordRowOrder(scenario.other.id.value, rows.dropLast(1) + RowId.generate().value),
        ).forEach { order ->
            assertFailsWith<WorkbookApplicationException> { scenario.app.deleteRecord(scenario.target.id.value, row, request.copy(rowOrders = listOf(order))) }
        }
        val missingModel = before.copy(dataModels = emptyMap())
        val missingModelRequest = prepareRecordDeletion(scenario.target.id.value, row, request.copy(before = WorkbookReadTransportAdapter.bundle(missingModel)))
        assertFailsWith<WorkbookApplicationException> { deleteRecord(missingModel, missingModelRequest) }
        assertEquals(before, store.loadWorkbookBundle())
        assertEquals(0, replayReceipts(store))
    }

    @Test
    fun `receipt canonicalizes unordered guards and order sheets but preserves axes and row order`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val before = store.loadWorkbookBundle()
        val guard = WorkbookReadTransportAdapter.bundle(before)
        val targetRows = before.findSheet(scenario.target.id)!!.tabularContent.rows.filter { it != scenario.row }.map { it.value }
        val otherRows = before.findSheet(scenario.other.id)!!.tabularContent.rows.map { it.value }
        val orders = listOf(RecordRowOrder(scenario.target.id.value, targetRows), RecordRowOrder(scenario.other.id.value, otherRows.reversed()))
        val request = RecordDeletionRequest(UUID.randomUUID().toString(), guard, orders)
        scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, request)
        val normalized = request.copy(operationId = request.operationId.uppercase(), rowOrders = orders.reversed().map { it.copy(sheetId = it.sheetId.uppercase(), order = it.order.map(String::uppercase)) }, before = guard.copy(
            documents = guard.documents.reversed().map { sheet -> sheet.copy(id = sheet.id.uppercase(), content = sheet.content.copy(cells = sheet.content.cells.reversed()), modelColumnBindings = sheet.modelColumnBindings.entries.reversed().associate { it.key.uppercase() to it.value.uppercase() }) },
            dataModels = guard.dataModels.reversed(),
        ))
        assertTrue(scenario.app.deleteRecord(scenario.target.id.value.uppercase(), scenario.row.value.uppercase(), normalized).alreadyCommitted)
        val current = store.loadWorkbookBundle()
        val changedAxis = guard.copy(documents = guard.documents.map { if (it.id == scenario.other.id.value) it.copy(content = it.content.copy(rows = it.content.rows.reversed())) else it })
        listOf(request.copy(before = changedAxis), request.copy(rowOrders = orders.map { if (it.sheetId == scenario.other.id.value) it.copy(order = it.order.reversed()) else it })).forEach { altered ->
            assertEquals(WorkbookApplicationError.INVALID_MODEL_RECORD, assertFailsWith<WorkbookApplicationException> { scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, altered) }.error)
        }
        assertEquals(current, store.loadWorkbookBundle())
    }

    @Test
    fun `deletion and admission replay cannot reuse operation identity`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val guard = WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle())
        val request = RecordDeletionRequest(UUID.randomUUID().toString(), guard)
        scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, request)
        val current = store.loadWorkbookBundle()
        val replay = RecordReplayRequest(request.operationId, "undo", guard)
        assertEquals(WorkbookApplicationError.INVALID_MODEL_RECORD, assertFailsWith<WorkbookApplicationException> { scenario.replay(replay) }.error)
        assertEquals(current, store.loadWorkbookBundle())
    }

    @Test
    fun `admission replay receipt rejects deletion reuse`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val replay = scenario.replayRequest("undo")
        scenario.replay(replay)
        val current = store.loadWorkbookBundle()
        val deletion = RecordDeletionRequest(replay.operationId, replay.before)
        assertEquals(WorkbookApplicationError.INVALID_MODEL_RECORD, assertFailsWith<WorkbookApplicationException> {
            scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, deletion)
        }.error)
        assertEquals(current, store.loadWorkbookBundle())
    }
}
