package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertTrue

class FunctionReplayReseedTest {
    @Test
    fun `repeated removal seeds bindings for declarations created or reset while caller was absent`() {
        for (reset in listOf(false, true)) {
            SqliteWorkbookStore.inMemory().use { store ->
                val app = DefaultWorkbookApplication(store)
                val caller = app.createSheet(CreateSheetCommand("Caller"))
                val target = app.createSheet(CreateSheetCommand("Target"))
                val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
                val before = if (reset) app.setFunction(app.loadWorkbookBundle(), declaration, null) else app.loadWorkbookBundle()
                val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
                val changed = if (reset) declaration.copy(parameters = listOf(CustomFunctionParameter("x", "int"))) else declaration
                app.setFunction(app.loadWorkbookBundle(), changed, if (reset) "f" else null)
                val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
                val original = restored.functions.single().bodyBindings.getValue(caller.id.value)
                app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "redo"))
                app.setFunction(app.loadWorkbookBundle(), changed.copy(body = "=@Target!A[1]+1"), "f")
                val inserted = RowId.generate()
                prependRow(store, target.id, inserted)
                val replayed = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
                val binding = replayed.functions.single().bodyBindings.getValue(caller.id.value)
                assertTrue(original.contains(target.tabularContent.rows.first().value), original)
                assertTrue(binding.contains(target.tabularContent.rows.first().value), binding)
                assertTrue(!binding.contains(inserted.value), binding)
            }
        }
    }

    private fun prependRow(store: SqliteWorkbookStore, sheetId: SheetId, row: RowId) {
        store.updateWorkbook { current ->
            val sheet = current.documents.getValue(sheetId)
            val content = sheet.tabularContent
            current.replaceSheet(sheet.copy(content = TabularContent(listOf(row) + content.rows, content.columns, content.cellContents)))
        }
    }
}
