package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FunctionReplayDurabilityTest {
    @Test
    fun `redo caller creation after reopen and retry retains captured lineage and axis identities`() {
        val path = tempSqlitePath()
        try {
            val redo = LifecycleReplayRequest(UUID.randomUUID().toString(), "redo")
            lateinit var transition: String
            lateinit var callerId: String
            lateinit var lineage: String
            lateinit var binding: String
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                val target = app.createSheet(CreateSheetCommand("Target"))
                val before = app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[1]"), null)
                val caller = DefaultWorkbookApplication(InMemoryWorkbookStore()).createSheet(CreateSheetCommand("Caller"))
                callerId = caller.id.value
                val admitted = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.addSheet(caller))))
                transition = admitted.transitionId
                val function = admitted.workbook.toLifecycleWorkbook().functions.single()
                lineage = function.identity
                binding = function.bodyBindings.getValue(caller.id.value)
                assertTrue(binding.contains(target.tabularContent.rows.first().value))
                assertTrue(binding.contains(target.tabularContent.columns.first().value))
                app.replayLifecycle(transition, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo"))
                store.updateWorkbook { workbook ->
                    val sheet = workbook.documents.getValue(target.id)
                    val content = sheet.tabularContent
                    workbook.replaceSheet(sheet.copy(content = TabularContent(listOf(RowId.generate()) + content.rows, content.columns, content.cellContents)))
                }
            }
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                val result = app.replayLifecycle(transition, redo)
                assertFalse(result.alreadyCommitted)
                val function = result.workbook.toLifecycleWorkbook().functions.single()
                assertEquals(lineage, function.identity)
                assertEquals(binding, function.bodyBindings.getValue(callerId))
            }
            SqliteWorkbookStore(path).use { store ->
                val retry = DefaultWorkbookApplication(store).replayLifecycle(transition, redo)
                assertTrue(retry.alreadyCommitted)
                val function = retry.workbook.toLifecycleWorkbook().functions.single()
                assertEquals(lineage, function.identity)
                assertEquals(binding, function.bodyBindings.getValue(callerId))
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }
}
