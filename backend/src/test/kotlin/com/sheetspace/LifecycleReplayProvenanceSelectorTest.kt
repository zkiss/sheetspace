package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LifecycleReplayProvenanceSelectorTest {
    @Test
    fun `restoration uses only provenance matching caller identity and exact binding source`() {
        val app = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val caller = app.createSheet(CreateSheetCommand("Caller"))
        val other = app.createSheet(CreateSheetCommand("Other"))
        val target = app.createSheet(CreateSheetCommand("Target"))
        val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
        val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
        val function = before.functions.single()
        val absent = before.removeSheet(caller.id)
        val documents = WorkbookReadTransportAdapter.bundle(before).documents.associateBy { it.id }
        val provenance = ReplayBindingProvenance(documents.getValue(caller.id.value), function.copy(bodyBindings = emptyMap()), "sentinel")
        val mismatches = listOf(
            provenance.copy(caller = documents.getValue(other.id.value)),
            provenance.copy(declaration = provenance.declaration.copy(identity = UUID.randomUUID().toString())),
            provenance.copy(declaration = provenance.declaration.copy(body = "=@Target!A[1]+1")),
            provenance.copy(declaration = provenance.declaration.copy(parameters = listOf(CustomFunctionParameter("x", "int")))),
        )

        for (mismatch in mismatches) {
            val binding = replayLifecycleWorkbook(absent, absent, before, listOf(mismatch)).functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(target.tabularContent.rows.first().value), binding)
            assertTrue(binding.contains(target.tabularContent.columns.first().value), binding)
        }
        assertEquals("sentinel", replayLifecycleWorkbook(absent, absent, before, listOf(provenance)).functions.single().bodyBindings.getValue(caller.id.value))
    }

    @Test
    fun `blank identity cannot select a shadow and matching null binding does not restore one`() {
        val app = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val caller = app.createSheet(CreateSheetCommand("Caller"))
        val target = app.createSheet(CreateSheetCommand("Target"))
        val before = app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[1]"), null)
        val document = WorkbookReadTransportAdapter.bundle(before).documents.single { it.id == caller.id.value }
        val function = before.functions.single()
        val blank = before.copy(functions = listOf(function.copy(identity = "")))
        val absentBlank = blank.removeSheet(caller.id)
        val blankShadow = ReplayBindingProvenance(document, function.copy(identity = ""), "sentinel")
        val fresh = replayLifecycleWorkbook(absentBlank, absentBlank, blank, listOf(blankShadow)).functions.single().bodyBindings.getValue(caller.id.value)
        assertTrue(fresh.contains(target.tabularContent.rows.first().value), fresh)
        assertTrue(fresh != "sentinel")

        val absent = before.removeSheet(caller.id).let { state ->
            state.copy(functions = state.functions.map { it.copy(bodyBindings = it.bodyBindings - caller.id.value) })
        }
        val nullShadow = ReplayBindingProvenance(document, function, null)
        val restored = replayLifecycleWorkbook(absent, absent, before, listOf(nullShadow))
        assertTrue(caller.id.value !in restored.functions.single().bodyBindings)
    }
}
