package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class CustomFunctionRecordHistoryTest {
    @Test
    fun `admission and deletion history preserve functions across reopen and reject function-only conflicts`() {
        val path = tempSqlitePath()
        val functions = listOf(CustomFunction("f", emptyList(), "=UNKNOWN(", mapOf(TEST_SHEET_1 to "=@stable")))
        lateinit var sheet: String
        lateinit var row: String
        lateinit var deletion: String
        try {
            SqliteWorkbookStore(path).use { store ->
                val scenario = AtomicAdmissionScenario(store)
                store.updateWorkbook { it.copy(functions = functions) }
                val before = WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle())
                scenario.admit(scenario.request.copy(before = before))
                sheet = scenario.target.id.value
                row = scenario.row.value
                assertEquals(functions, store.loadWorkbookBundle().functions)
            }
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                fun request(direction: String) = RecordReplayRequest(UUID.randomUUID().toString(), direction, WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
                app.replayRecord(sheet, row, request("undo"))
                assertEquals(functions, store.loadWorkbookBundle().functions)
                app.replayRecord(sheet, row, request("redo"))
                assertEquals(functions, store.loadWorkbookBundle().functions)
                deletion = app.deleteRecord(sheet, row, RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))).deletionId
            }
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                val stale = WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle())
                store.updateWorkbook { it.copy(functions = functions.map { function -> function.copy(body = "=changed") }) }
                val changed = store.loadWorkbookBundle()
                fun undo(guard: WorkbookBundleResponse) = app.replayDeletion(sheet, row, deletion, RecordReplayRequest(UUID.randomUUID().toString(), "undo", guard))
                assertFailsWith<WorkbookApplicationException> { undo(stale) }
                assertFailsWith<WorkbookApplicationException> { undo(WorkbookReadTransportAdapter.bundle(changed)) }
                assertEquals(changed, store.loadWorkbookBundle())
                store.updateWorkbook { it.copy(functions = functions) }
                undo(WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
                assertEquals(functions, store.loadWorkbookBundle().functions)
                assertTrue(RowId(row) in store.loadSheet(SheetId(sheet))!!.tabularContent.rows)
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }
}
