package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class FunctionReplayResetTest {
    @Test
    fun `admitted deletion and recreation cannot revive absent caller lineage`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            app.admitFunctionDelete(FunctionDeleteRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle()), "f"))
            val row = RowId.generate()
            store.updateWorkbook { current ->
                val sheet = current.documents.getValue(target.id)
                val content = sheet.tabularContent
                current.replaceSheet(sheet.copy(content = TabularContent(listOf(row) + content.rows, content.columns, content.cellContents)))
            }
            val recreated = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            assertNotEquals(before.functions.single().identity, recreated.functions.single().identity)
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(row.value), binding)
            assertTrue(!binding.contains(target.tabularContent.rows.first().value), binding)
            assertTrue(binding.contains(target.tabularContent.columns.first().value), binding)
        }
    }

    @Test
    fun `reordering or changing parameter count away and back discards absent lineage`() {
        val parameters = listOf(CustomFunctionParameter("a", "int"), CustomFunctionParameter("b", "int"))
        for (changed in listOf(parameters.reversed(), parameters.take(1))) {
            SqliteWorkbookStore.inMemory().use { store ->
                val app = DefaultWorkbookApplication(store)
                val caller = app.createSheet(CreateSheetCommand("Caller"))
                val target = app.createSheet(CreateSheetCommand("Target"))
                val declaration = CustomFunction("f", parameters, "=@Target!A[1]")
                val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
                val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
                val edited = app.setFunction(app.loadWorkbookBundle(), declaration.copy(parameters = changed), "f")
                val reverted = app.setFunction(edited, declaration, "f")
                assertNotEquals(before.functions.single().identity, reverted.functions.single().identity)
                val freshRow = RowId.generate()
                store.updateWorkbook { current ->
                    val sheet = current.documents.getValue(target.id)
                    val content = sheet.tabularContent
                    current.replaceSheet(sheet.copy(content = TabularContent(listOf(freshRow) + content.rows, content.columns, content.cellContents)))
                }
                val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
                val function = restored.functions.single()
                val binding = function.bodyBindings.getValue(caller.id.value)
                assertEquals(parameters, function.parameters)
                assertTrue(binding.contains(freshRow.value), binding)
                assertTrue(!binding.contains(target.tabularContent.rows.first().value), binding)
                assertTrue(binding.contains(target.tabularContent.columns.first().value), binding)
            }
        }
    }
}
