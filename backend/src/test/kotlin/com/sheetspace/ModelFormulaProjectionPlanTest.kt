package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals

class ModelFormulaProjectionPlanTest {
    @Test
    fun `unbound property names produce identity based edits without changing literals`() {
        val old = DataModel("model", "Model", listOf(ManualModelColumn("input", "Old", ModelColumnType.INT)))
        val updated = old.copy(columns = listOf(ManualModelColumn("input", "O'Brien total", ModelColumnType.INT)))
        val before = emptyWorkbookState().copy(dataModels = mapOf(old.id to old))
        val after = before.copy(dataModels = mapOf(updated.id to updated))
        val formula = "=@Old[1]+\"Old\""

        val edits = renamedDeclarationEdits(before, after, old, formula)

        assertEquals("=@'O''Brien total'[1]+\"Old\"", applyFormulaNameEdits(formula, edits))
    }
}
