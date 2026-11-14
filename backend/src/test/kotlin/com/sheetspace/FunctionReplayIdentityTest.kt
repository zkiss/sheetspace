package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertFailsWith

class FunctionReplayIdentityTest {
    @Test
    fun `declaration edits retain lineage only for unchanged binding source`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            app.createSheet(CreateSheetCommand("Caller"))
            val original = CustomFunction("f", listOf(CustomFunctionParameter("a", "int"), CustomFunctionParameter("b", "int")), "=a")
            var current = app.setFunction(app.loadWorkbookBundle(), original, null)
            var lineage = current.functions.single().identity
            for (edit in listOf(original.copy(name = "F"), original.copy(name = "g", parameters = original.parameters.map { it.copy(type = "float") }))) {
                current = app.setFunction(current, edit, current.functions.single().name)
                assertEquals(lineage, current.functions.single().identity)
            }
            val edits = listOf(
                original.copy(body = "=b"), original,
                original.copy(parameters = original.parameters.reversed()),
                original.copy(parameters = listOf(original.parameters.first())),
                original.copy(parameters = listOf(CustomFunctionParameter("x", "int"))),
                original,
            )
            for (edit in edits) {
                current = app.setFunction(current, edit, current.functions.single().name)
                assertNotEquals(lineage, current.functions.single().identity)
                lineage = current.functions.single().identity
            }
        }
    }

    @Test
    fun `renamed and retyped declarations restore captured caller binding rather than retargeting`() {
        for ((name, type) in listOf("g" to "int", "f" to "float", "g" to "float")) {
            SqliteWorkbookStore.inMemory().use { store ->
                val app = DefaultWorkbookApplication(store)
                val caller = app.createSheet(CreateSheetCommand("Caller"))
                val target = app.createSheet(CreateSheetCommand("Target"))
                val declaration = CustomFunction("f", listOf(CustomFunctionParameter("a", "int")), "=@Target!A[1]")
                val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
                val original = before.functions.single()
                val admitted = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
                val edited = declaration.copy(name = name, parameters = listOf(CustomFunctionParameter("a", type)))
                app.setFunction(app.loadWorkbookBundle(), edited, "f")
                store.updateWorkbook { current ->
                    val sheet = current.documents.getValue(target.id)
                    val content = sheet.tabularContent
                    current.replaceSheet(sheet.copy(content = TabularContent(listOf(RowId.generate()) + content.rows, content.columns, content.cellContents)))
                }
                repeat(2) {
                    val restored = app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
                    val function = restored.functions.single()
                    assertEquals(name, function.name)
                    assertEquals(type, function.parameters.single().type)
                    assertEquals(original.identity, function.identity)
                    assertEquals(original.bodyBindings, function.bodyBindings)
                    app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "redo"))
                }
            }
        }
    }

    @Test
    fun `recreated declaration prepares restored caller against current identities`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val oldBinding = before.functions.single().bodyBindings.getValue(caller.id.value)
            val admitted = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            app.deleteFunction(app.loadWorkbookBundle(), "f")
            store.updateWorkbook { current ->
                val sheet = current.documents.getValue(target.id)
                val content = sheet.tabularContent
                current.replaceSheet(sheet.copy(content = TabularContent(listOf(RowId.generate()), content.columns, emptyMap())))
            }
            val recreated = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val newBinding = recreated.functions.single().bodyBindings.getValue(target.id.value)
            assertNotEquals(before.functions.single().identity, recreated.functions.single().identity)
            assertNotEquals(oldBinding, newBinding)
            val restored = app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            assertEquals(newBinding, restored.functions.single().bodyBindings.getValue(caller.id.value))
        }
    }

    @Test
    fun `restoration follows lineage when old name is reused and body is edited`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val oldBinding = before.functions.single().bodyBindings.getValue(caller.id.value)
            val admitted = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            val renamed = app.setFunction(app.loadWorkbookBundle(), declaration.copy(name = "g"), "f")
            app.setFunction(renamed, declaration, null)
            store.updateWorkbook { current ->
                val sheet = current.documents.getValue(target.id)
                val content = sheet.tabularContent
                current.replaceSheet(sheet.copy(content = TabularContent(listOf(RowId.generate()) + content.rows, content.columns, content.cellContents)))
            }
            val restored = app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            assertEquals(oldBinding, restored.functions.single { it.name == "g" }.bodyBindings.getValue(caller.id.value))
            assertNotEquals(oldBinding, restored.functions.single { it.name == "f" }.bodyBindings.getValue(caller.id.value))
            app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "redo"))
            val current = app.loadWorkbookBundle()
            val changed = app.setFunction(current, declaration.copy(name = "g", body = "=@Target!A[1] "), "g")
            assertNotEquals(restored.functions.single { it.name == "g" }.identity, changed.functions.single { it.name == "g" }.identity)
            val again = app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val retained = again.functions.single { it.name == "g" }.bodyBindings.getValue(caller.id.value)
            kotlin.test.assertTrue(retained.contains(target.tabularContent.rows.first().value))
            kotlin.test.assertTrue(retained.contains(target.tabularContent.columns.first().value))
        }
    }

    @Test
    fun `client cannot supply declaration identity`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val before = app.loadWorkbookBundle()
            assertFailsWith<WorkbookApplicationException> {
                app.setFunction(before, CustomFunction("f", emptyList(), "=1", identity = UUID.randomUUID().toString()), null)
            }
            assertEquals(before, app.loadWorkbookBundle())
        }
    }

    @Test
    fun `parameter rename and edit away and back prepare fresh restored caller bindings`() {
        for (returnToOriginal in listOf(false, true)) {
            SqliteWorkbookStore.inMemory().use { store ->
                val app = DefaultWorkbookApplication(store)
                val caller = app.createSheet(CreateSheetCommand("Caller"))
                val target = app.createSheet(CreateSheetCommand("Target"))
                val declaration = CustomFunction("f", listOf(CustomFunctionParameter("a", "int")), "=@Target!A[1]")
                val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
                val original = before.functions.single()
                val oldBinding = original.bodyBindings.getValue(caller.id.value)
                val admitted = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
                val edited = app.setFunction(app.loadWorkbookBundle(), declaration.copy(parameters = listOf(CustomFunctionParameter("b", "int"))), "f")
                val current = if (returnToOriginal) app.setFunction(edited, declaration, "f") else edited
                assertNotEquals(original.identity, current.functions.single().identity)
                if (returnToOriginal) assertNotEquals(edited.functions.single().identity, current.functions.single().identity)
                val row = RowId.generate()
                store.updateWorkbook { workbook ->
                    val sheet = workbook.documents.getValue(target.id)
                    val content = sheet.tabularContent
                    workbook.replaceSheet(sheet.copy(content = TabularContent(listOf(row) + content.rows, content.columns, content.cellContents)))
                }
                val restored = app.replayLifecycle(admitted.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
                val function = restored.functions.single()
                val fresh = function.bodyBindings.getValue(caller.id.value)
                assertEquals(current.functions.single().identity, function.identity)
                assertEquals(current.functions.single().parameters, function.parameters)
                assertNotEquals(oldBinding, fresh)
                assertEquals(current.functions.single().bodyBindings.getValue(target.id.value), function.bodyBindings.getValue(target.id.value))
                kotlin.test.assertTrue(fresh.contains(row.value))
                kotlin.test.assertTrue(fresh.contains(target.tabularContent.columns.first().value))
            }
        }
    }
}
