package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class FunctionAdmissionTest {
    @Test
    fun `create rename and delete definitions with trusted bindings and conflict detection`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand("Inputs"))
        val before = application.loadWorkbookBundle()
        val definition = CustomFunction("total", listOf(CustomFunctionParameter("a", "int")), "=SUM(a,@A[1])")

        val created = application.setFunction(before, definition, null)
        val binding = created.functions.single().bodyBindings.getValue(sheet.id.value)
        assertTrue(binding.contains(sheet.tabularContent.rows.first().value))
        assertFailsWith<WorkbookApplicationException> { application.setFunction(before, definition, null) }

        val renamed = application.setFunction(created, definition.copy(name = "renamed"), "TOTAL")
        assertEquals(binding, renamed.functions.single().bodyBindings.getValue(sheet.id.value))
        assertFailsWith<WorkbookApplicationException> { application.deleteFunction(created, "renamed") }
        assertFailsWith<WorkbookApplicationException> { application.deleteFunction(renamed, "missing") }
        assertFailsWith<WorkbookApplicationException> { application.setFunction(renamed, definition, "missing") }
        assertTrue(application.deleteFunction(renamed, "RENAMED").functions.isEmpty())
    }

    @Test
    fun `reject invalid metadata and supplied bindings without partial writes`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        application.createSheet(CreateSheetCommand("Inputs"))
        val before = application.loadWorkbookBundle()
        val invalid = listOf(
            CustomFunction("sum", emptyList(), "=1"),
            CustomFunction("ok", listOf(CustomFunctionParameter("x", "wrong")), "=1"),
            CustomFunction("ok", emptyList(), "=1", mapOf("forged" to "=@evil")),
        )
        invalid.forEach { assertFailsWith<WorkbookApplicationException> { application.setFunction(before, it, null) } }
        assertEquals(before, application.loadWorkbookBundle())
        val accepted = application.setFunction(before, CustomFunction("ok", emptyList(), "=@forged!identity"), null)
        assertFalse(accepted.functions.single().bodyBindings.values.single().contains("=@forged!identity"))
        assertFailsWith<WorkbookApplicationException> { application.setFunction(accepted, CustomFunction("OK", emptyList(), "=1"), null) }
        assertEquals(accepted, application.loadWorkbookBundle())
    }

    @Test
    fun `new and deleted sheets maintain independent caller bindings`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val first = application.createSheet(CreateSheetCommand("First"))
        val created = application.setFunction(application.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@A[1]"), null)
        val firstBinding = created.functions.single().bodyBindings.getValue(first.id.value)
        val second = application.createSheet(CreateSheetCommand("Second"))
        val both = application.loadWorkbookBundle().functions.single().bodyBindings
        assertEquals(firstBinding, both.getValue(first.id.value))
        assertNotEquals(firstBinding, both.getValue(second.id.value))
        application.deleteSheet(second.id.value, second.revision)
        val replacement = application.createSheet(CreateSheetCommand("Second"))
        val bindings = application.loadWorkbookBundle().functions.single().bodyBindings
        assertFalse(bindings.containsKey(second.id.value))
        assertTrue(bindings.containsKey(replacement.id.value))
        assertEquals(firstBinding, bindings.getValue(first.id.value))
    }

    @Test
    fun `non formula drafts persist and sheet creation does not attempt to bind them`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        application.createSheet(CreateSheetCommand("First"))
        application.setFunction(application.loadWorkbookBundle(), CustomFunction("draft", emptyList(), "not a formula"), null)
        application.createSheet(CreateSheetCommand("Second"))
        val saved = application.loadWorkbookBundle().functions.single()
        assertEquals("not a formula", saved.body)
        assertTrue(saved.bodyBindings.isEmpty())
    }

    @Test
    fun `explicit identities remain broken after deleting and reusing a sheet name`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val caller = application.createSheet(CreateSheetCommand("Caller"))
        val target = application.createSheet(CreateSheetCommand("Target"))
        application.setFunction(application.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[1]"), null)
        val original = application.loadWorkbookBundle().functions.single().bodyBindings.getValue(caller.id.value)
        assertTrue(original.contains(target.id.value))
        application.deleteSheet(target.id.value, target.revision)
        val replacement = application.createSheet(CreateSheetCommand("Target"))
        val bindings = application.loadWorkbookBundle().functions.single().bodyBindings
        assertEquals(original, bindings.getValue(caller.id.value))
        assertTrue(bindings.getValue(replacement.id.value).contains(replacement.id.value))
    }

    @Test
    fun `lifecycle membership changes bind new callers and discard deleted caller identities`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val caller = application.createSheet(CreateSheetCommand("Caller"))
        val before = application.setFunction(application.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@A[1]"), null)
        val original = before.functions.single().bodyBindings.getValue(caller.id.value)
        val other = DefaultWorkbookApplication(InMemoryWorkbookStore()).createSheet(CreateSheetCommand("Other"))

        val added = application.saveModelLifecycle(before, before.addSheet(other))
        assertEquals(added, application.saveModelLifecycle(before, before.addSheet(other)))
        val addedBinding = added.functions.single().bodyBindings.getValue(other.id.value)
        assertEquals(original, added.functions.single().bodyBindings.getValue(caller.id.value))
        assertTrue(addedBinding.contains(other.tabularContent.rows.first().value))

        val removed = application.saveModelLifecycle(added, added.removeSheet(other.id))
        assertEquals(removed, application.saveModelLifecycle(added, added.removeSheet(other.id)))
        assertFalse(removed.functions.single().bodyBindings.containsKey(other.id.value))
        val replacement = DefaultWorkbookApplication(InMemoryWorkbookStore()).createSheet(CreateSheetCommand("Other")).copy(id = other.id)
        assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE,
            assertFailsWith<WorkbookApplicationException> { application.saveModelLifecycle(removed, removed.addSheet(replacement)) }.error)
        assertEquals(removed, application.loadWorkbookBundle())
    }

    @Test
    fun `lifecycle membership changes reject client supplied bindings atomically`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        application.createSheet(CreateSheetCommand("Caller"))
        val before = application.setFunction(application.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@A[1]"), null)
        val other = DefaultWorkbookApplication(InMemoryWorkbookStore()).createSheet(CreateSheetCommand("Other"))
        val forged = before.addSheet(other).copy(functions = before.functions.map { it.copy(bodyBindings = it.bodyBindings + (other.id.value to "=forged")) })

        assertFailsWith<WorkbookApplicationException> { application.saveModelLifecycle(before, forged) }
        assertEquals(before, application.loadWorkbookBundle())
    }
}
