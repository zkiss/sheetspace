package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertFalse

class ReplayBindingAdmissionTest {
    @Test
    fun `qualified references exclude absent caller but resolve a live replacement`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val replacement = app.createSheet(CreateSheetCommand("Replacement"))
            val declaration = CustomFunction("f", emptyList(), "=@A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val previous = before.functions.single()
            val captured = WorkbookReadTransportAdapter.bundle(before).documents.single { it.id == caller.id.value }
            val state = ReplayBindingProvenance(captured, previous.copy(bodyBindings = emptyMap()), previous.bodyBindings.getValue(caller.id.value))
            val absent = before.removeSheet(caller.id)
            val next = declaration.copy(body = "=@A[1]+@Caller!A[1]")

            val unresolved = SharedFunctionAdmission.reconcileAbsentBinding(absent, state, next)!!
            assertContains(unresolved, before.documents.getValue(caller.id).tabularContent.columns.first().value)
            assertContains(unresolved, "~{")
            assertFalse(unresolved.contains("@${caller.id.value}!"))

            val reused = absent.replaceSheet(absent.documents.getValue(replacement.id).rename("Caller"))
            val resolved = SharedFunctionAdmission.reconcileAbsentBinding(reused, state, next)!!
            assertContains(resolved, "@${replacement.id.value}!")
            assertContains(resolved, before.documents.getValue(caller.id).tabularContent.columns.first().value)
            assertFalse(resolved.contains("~{"))
        }
    }

    @Test
    fun `absent caller uses captured local structure and current external context`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]+@A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val previous = before.functions.single()
            val captured = WorkbookReadTransportAdapter.bundle(before).documents.single { it.id == caller.id.value }
            val state = ReplayBindingProvenance(captured, previous.copy(bodyBindings = emptyMap()), previous.bodyBindings.getValue(caller.id.value))
            val absent = before.removeSheet(caller.id)
            val targetSheet = absent.documents.getValue(target.id)
            val newRow = RowId.generate()
            val changed = absent.replaceSheet(targetSheet.copy(content = TabularContent(listOf(newRow) + targetSheet.tabularContent.rows, targetSheet.tabularContent.columns, targetSheet.tabularContent.cellContents)))
            val next = declaration.copy(body = "=@Target!A[1]+@A[1]+1")
            val binding = SharedFunctionAdmission.reconcileAbsentBinding(changed, state, next)!!
            assertContains(binding, targetSheet.tabularContent.rows.first().value)
            assertContains(binding, before.documents.getValue(caller.id).tabularContent.rows.first().value)
            assertEquals(state.binding, SharedFunctionAdmission.reconcileAbsentBinding(changed, state, declaration))
            assertNull(SharedFunctionAdmission.reconcileAbsentBinding(changed, state, declaration.copy(body = "draft")))
            assertEquals(absent.manifest.sheetIds, changed.manifest.sheetIds)
        }
    }
}
