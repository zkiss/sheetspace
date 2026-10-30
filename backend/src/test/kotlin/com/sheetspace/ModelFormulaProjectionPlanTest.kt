package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ModelFormulaProjectionPlanTest {
    @Test
    fun `projection ignores removed or rebound identities and follows quoted old names`() {
        val before = lifecycleBoundWorkbook(lifecycleWorkbook())
        val sheet = before.sheetsInOrder.first()
        val model = before.dataModels.getValue(LIFECYCLE_MODEL)
        val input = model.columns.single { it.id == LIFECYCLE_INPUT } as ManualModelColumn
        val quotedModel = model.copy(columns = model.columns.map { if (it.id == input.id) input.copy(name = "O'Brien") else it })
        val named = before.copy(dataModels = before.dataModels + (model.id to quotedModel))
        val renamed = quotedModel.copy(columns = quotedModel.columns.map { if (it.id == input.id) input.copy(name = "Next") else it })
        val after = named.copy(dataModels = named.dataModels + (model.id to renamed))
        val local = "=@\$'O''Brien'[1]"
        val qualified = "=@'${sheet.name}'!'O''Brien'[1]"
        fun project(workbook: WorkbookState, formula: String) = applyFormulaNameEdits(formula, renamedDeclarationEdits(named, workbook, quotedModel, formula))

        assertEquals("=@\$Next[1]", project(after, local))
        assertEquals("=@'${sheet.name}'!Next[1]", project(after, qualified))
        assertEquals(local, project(named, local))
        assertEquals(local, project(after.copy(dataModels = emptyMap()), local))
        assertEquals(qualified, project(after.removeSheet(sheet.id), qualified))
        assertEquals(qualified, project(after.replaceSheet(sheet.copy(modelId = null, modelColumnBindings = emptyMap())), qualified))
        assertEquals(qualified, project(after.replaceSheet(sheet.copy(modelColumnBindings = sheet.modelColumnBindings + (input.id to ColumnId.generate()))), qualified))
        assertEquals("=@Unknown!Input[1]", project(after, "=@Unknown!Input[1]"))
    }

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

    @Test
    fun `qualified ordinary name projection requires the same surviving sheet and column`() {
        val before = lifecycleBoundWorkbook(lifecycleWorkbook())
        val sheet = before.sheetsInOrder.first()
        val model = before.dataModels.getValue(LIFECYCLE_MODEL)
        val column = ColumnId.generate()
        val named = before.replaceSheet(sheet.copy(columnNames = mapOf(column.value to "Local")))
        val formula = "=@'${sheet.name}'!Local[1]"
        fun project(workbook: WorkbookState) = applyFormulaNameEdits(formula, renamedDeclarationEdits(named, workbook, model, formula))
        val renamed = named.replaceSheet(named.documents.getValue(sheet.id).copy(columnNames = mapOf(column.value to "New")))

        assertEquals("=@'${sheet.name}'!New[1]", project(renamed))
        assertEquals(formula, project(named))
        assertEquals(formula, project(named.removeSheet(sheet.id)))
        assertEquals(formula, project(named.replaceSheet(sheet.copy(columnNames = emptyMap()))))
        assertEquals(formula, project(named.replaceSheet(sheet.copy(columnNames = mapOf(ColumnId.generate().value to "New")))))
    }

}
