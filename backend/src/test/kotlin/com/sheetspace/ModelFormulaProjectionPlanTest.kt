package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

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

    @Test
    fun `qualified property and ordinary names follow bound sheet identities`() {
        val before = lifecycleBoundWorkbook(lifecycleWorkbook())
        val sheet = before.sheetsInOrder.first()
        val model = before.dataModels.getValue(LIFECYCLE_MODEL)
        val column = sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT)
        val ordinary = ColumnId.generate()
        val named = before.replaceSheet(sheet.copy(columnNames = mapOf(ordinary.value to "Local")))
        val afterModel = model.copy(columns = model.columns.map {
            if (it.id == LIFECYCLE_INPUT) (it as ManualModelColumn).copy(name = "New name") else it
        })
        val after = named.copy(dataModels = named.dataModels + (model.id to afterModel)).replaceSheet(
            named.documents.getValue(sheet.id).copy(columnNames = mapOf(ordinary.value to "Local2")),
        )
        val formula = "=@'${sheet.name}'!\$Input[1]:Local[2]+@Missing[1]"

        val edits = renamedDeclarationEdits(named, after, model, formula)

        assertEquals("=@'${sheet.name}'!\$'New name'[1]:Local2[2]+@Missing[1]", applyFormulaNameEdits(formula, edits))
        val unbound = after.replaceSheet(after.documents.getValue(sheet.id).copy(modelColumnBindings = sheet.modelColumnBindings - LIFECYCLE_INPUT))
        assertEquals("=@'${sheet.name}'!\$Input[1]:Local2[2]+@Missing[1]", applyFormulaNameEdits(formula, renamedDeclarationEdits(named, unbound, model, formula)))
        assertEquals(column, sheet.modelColumnBindings[LIFECYCLE_INPUT])
    }

    @Test
    fun `opaque range projection changes only associated name payloads`() {
        val declaration = "=@Old[1]:Missing[2]+\"Old\""
        val content = "=" + StoredFormulaCodec.escape("@Old[1]:Missing[2]") + "+\"Old\""
        val start = declaration.indexOf("Old")
        val edits = listOf(FormulaNameEdit(start, start + 3, "'O''Brien'"))

        assertEquals("=" + StoredFormulaCodec.escape("@'O''Brien'[1]:Missing[2]") + "+\"Old\"", projectOpaqueModelTemplate(content, declaration, edits))
        assertEquals(content, projectOpaqueModelTemplate(content, declaration, emptyList()))
        assertNull(projectOpaqueModelTemplate(content, declaration.replace("+", "-"), edits))
    }
}
