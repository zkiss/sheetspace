package com.sheetspace

import java.nio.file.Files
import java.sql.SQLException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AtomicAdmissionReceiptTest {
    @Test
    fun `lost response retry after reopen confirms the operation and returns the complete saved workbook`() {
        val directory = Files.createTempDirectory("atomic-admission")
        val path = directory.resolve("workbook.db")
        try {
            lateinit var request: RecordAdmissionRequest
            lateinit var expected: RecordAdmissionResult
            lateinit var target: SheetDocument
            SqliteWorkbookStore(path).use { store ->
                val scenario = AtomicAdmissionScenario(store)
                request = scenario.request
                target = scenario.target
                expected = scenario.admit()
            }
            SqliteWorkbookStore(path).use { store ->
                val retried = DefaultWorkbookApplication(store).admitRecord(target.id.value, target.revision, request.rowId, request.values, request.before, request.rowOrders)
                assertEquals(expected.copy(alreadyCommitted = true), retried)
                assertEquals(expected.workbook, store.loadWorkbookBundle())
                assertEquals(1, admissionReceipts(store))
            }
        } finally {
            directory.toFile().deleteRecursively()
        }
    }

    @Test
    fun `receipt retries after editing reordering and deletion confirm without restoring any old state`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val sheet = scenario.app.loadSheet(scenario.target.id.value)
        val edited = scenario.app.writeOneCell(sheet.id.value, "A1", "88", sheet.revision)
        scenario.app.reorderAxis(edited.id.value, edited.revision, "row", edited.tabularContent.rows.reversed().map { it.value })
        val current = store.loadWorkbookBundle()
        val retry = scenario.admit()
        assertTrue(retry.alreadyCommitted)
        assertEquals(current, retry.workbook)
        assertEquals(current, store.loadWorkbookBundle())
        scenario.app.deleteSheet(scenario.target.id.value, current.documents.getValue(sheet.id).revision)
        val deleted = store.loadWorkbookBundle()
        assertEquals(1, admissionReceipts(store))
        assertEquals(RecordAdmissionResult(scenario.row, true, deleted), scenario.admit())
        assertEquals(deleted, store.loadWorkbookBundle())
    }

    @Test
    fun `changed values guards and orders cannot reuse a committed receipt`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val committed = scenario.admit()
        val request = scenario.request
        val guard = request.before
        val changed = listOf(
            request.copy(values = mapOf(LIFECYCLE_INPUT to "3")),
            request.copy(before = WorkbookReadTransportAdapter.bundle(committed.workbook)),
            request.copy(before = guard.copy(dataModels = guard.dataModels.map { it.copy(name = "Changed") })),
            request.copy(before = guard.copy(manifest = guard.manifest.copy(revision = 99))),
            request.copy(rowOrders = request.rowOrders.map { it.copy(order = it.order.reversed()) }),
            request.copy(rowOrders = emptyList()),
        )
        changed.forEach { altered ->
            assertFailsWith<WorkbookApplicationException> { scenario.admit(altered) }
            assertEquals(committed.workbook, store.loadWorkbookBundle())
            assertEquals(1, admissionReceipts(store))
        }
        assertFailsWith<WorkbookApplicationException> { scenario.admit(revision = scenario.target.revision + 1) }
        assertTrue(scenario.admit().alreadyCommitted)
    }

    @Test
    fun `receipt failure after aggregate SQL writes rolls back sheets revisions and receipt and permits corrected retry`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        admissionSql(store, "CREATE TRIGGER fail_admission BEFORE INSERT ON record_admissions BEGIN SELECT RAISE(ABORT, 'receipt failure'); END")
        assertFailsWith<SQLException> { scenario.admit() }
        assertEquals(scenario.before, store.loadWorkbookBundle())
        assertEquals(0, admissionReceipts(store))
        admissionSql(store, "DROP TRIGGER fail_admission")
        val admitted = scenario.admit(scenario.request.copy(values = mapOf(LIFECYCLE_INPUT to "6")))
        assertFalse(admitted.alreadyCommitted)
        assertEquals(scenario.target.revision + 1, admitted.workbook.documents.getValue(scenario.target.id).revision)
        assertEquals(scenario.other.revision + 1, admitted.workbook.documents.getValue(scenario.other.id).revision)
        assertEquals(1, admissionReceipts(store))
    }
}
