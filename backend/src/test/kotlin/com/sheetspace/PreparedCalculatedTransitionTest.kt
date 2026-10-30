package com.sheetspace

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class PreparedCalculatedTransitionTest {
    @Test
    fun `mixed fixture keeps dead target identity and historical bytes after replacement`() {
        val fixture = Json.parseToJsonElement(requireNotNull(javaClass.getResource("/stored-model-instances.json")).readText()).jsonArray.first().jsonObject
        val template = PreparedModelFormula(fixture.getValue("template").jsonPrimitive.content)
        val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
        val base = initial.removeSheet(initial.sheetsInOrder.last().id)
        val sheet = base.sheetsInOrder.first()
        val model = base.dataModels.getValue(LIFECYCLE_MODEL)
        val property = model.columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn
        val mixedModel = model.copy(columns = model.columns.map { if (it.id == property.id) property.copy(formula = "=@A[1]:B[2]+???😀") else it })
        val rows = listOf(RowId("sheet:row:1"), RowId("sheet:row:2"), RowId("sheet:row:3"))
        val target = SheetDocument(SheetId("sheet"), name = "Inputs", content = TabularContent(rows, listOf(ColumnId("col1"), ColumnId("col2")), emptyMap()))
        val withTarget = base.copy(dataModels = base.dataModels + (model.id to mixedModel)).addSheet(target)
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val contents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, withTarget, index, mixedModel.columns.filterIsInstance<CalculatedModelColumn>().single().formula, sheet.id.value)
        }
        val before = withTarget.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents)))
        val replacement = before.removeSheet(target.id).addSheet(target.copy(id = SheetId("replacement")))
        val rules = preparedCalculatedTemplates { candidate -> if (candidate.id == sheet.id) mapOf(LIFECYCLE_OUTPUT to template) else null }

        assertEquals(fixture.getValue("expected").jsonPrimitive.content, derivedPreparedFormulaRaw(template, before, 1, mixedModel.columns.filterIsInstance<CalculatedModelColumn>().single().formula, sheet.id.value))
        assertTrue(calculatedTransitionIsValid(before, replacement, rules))
        assertEquals(contents, replacement.documents.getValue(sheet.id).tabularContent.cellContents)
        val targetId = SheetId.generate()
        val targetRows = rows.map { RowId.generate() }
        val targetColumns = listOf(ColumnId.generate(), ColumnId.generate())
        var persistedTemplate = template.content.replace("sheet!", "${targetId.value}!")
        rows.zip(targetRows).forEach { (old, new) -> persistedTemplate = persistedTemplate.replace(old.value, new.value) }
        listOf("col1", "col2").zip(targetColumns).forEach { (old, new) -> persistedTemplate = persistedTemplate.replace(old, new.value) }
        val persistedRules = preparedCalculatedTemplates { candidate -> if (candidate.id == sheet.id) mapOf(LIFECYCLE_OUTPUT to PreparedModelFormula(persistedTemplate)) else null }
        val persistedTarget = target.copy(id = targetId, content = TabularContent(targetRows, targetColumns, emptyMap()))
        val live = withTarget.removeSheet(target.id).addSheet(persistedTarget)
        val persistedContents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(PreparedModelFormula(persistedTemplate), live, index, mixedModel.columns.filterIsInstance<CalculatedModelColumn>().single().formula, sheet.id.value)
        }
        val persistedBefore = live.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, persistedContents)))
        val newTarget = SheetDocument(SheetId.generate(), name = "Inputs", content = TabularContent(
            listOf(RowId.generate()), listOf(ColumnId.generate()), emptyMap(),
        ))
        SqliteWorkbookStore.inMemory(calculatedAdmission = { current, updated ->
            rejectCalculatedOverrides(current, updated, persistedRules)
        }).use { store ->
            store.saveWorkbook(persistedBefore)
            store.saveWorkbook(store.loadWorkbookBundle().removeSheet(targetId))
            store.updateWorkbook(null) { it.addSheet(newTarget) }
            assertEquals(persistedContents, store.loadWorkbookBundle().documents.getValue(sheet.id).tabularContent.cellContents)
        }
    }

    @Test
    fun `prepared materializers derive appended and missing rows without replacing historical bytes`() {
        val fixture = Json.parseToJsonElement(requireNotNull(javaClass.getResource("/stored-model-instances.json")).readText()).jsonArray.first().jsonObject
        val template = PreparedModelFormula(fixture.getValue("template").jsonPrimitive.content)
        val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
        val base = initial.removeSheet(initial.sheetsInOrder.last().id)
        val sheet = base.sheetsInOrder.first()
        val target = SheetDocument(SheetId("sheet"), name = "Inputs", content = TabularContent(
            listOf(RowId("sheet:row:1"), RowId("sheet:row:2"), RowId("sheet:row:3")), listOf(ColumnId("col1"), ColumnId("col2")), emptyMap(),
        ))
        val rules = preparedCalculatedTemplates { if (it.id == sheet.id) mapOf(LIFECYCLE_OUTPUT to template) else null }
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val row = RowId.generate()
        val existing = sheet.tabularContent.rows.first()
        val staged = sheet.copy(content = TabularContent(listOf(existing, row), sheet.tabularContent.columns, mapOf(CellCoordinate(existing, output) to "historic")))
        val workbook = base.replaceSheet(staged).addSheet(target)
        val appended = materializeCalculatedRow(workbook, staged, row, rules)
        assertEquals("historic", appended.tabularContent.cellContents[CellCoordinate(existing, output)])
        assertEquals(fixture.getValue("expected").jsonPrimitive.content, appended.tabularContent.cellContents[CellCoordinate(row, output)])
        val refreshed = materializeDerivedContents(workbook, rules).documents.getValue(sheet.id)
        assertEquals(appended.tabularContent.cellContents, refreshed.tabularContent.cellContents)
    }

    @Test
    fun `renaming retains historical bytes while changing declaration derives replacements`() {
        val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
        val base = initial.removeSheet(initial.sheetsInOrder.last().id)
        val sheet = base.sheetsInOrder.first()
        val model = base.dataModels.getValue(LIFECYCLE_MODEL)
        val property = model.columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn
        val template = PreparedModelFormula(property.formula)
        val changed = PreparedModelFormula("=42")
        val rules = preparedCalculatedTemplates { candidate ->
            mapOf(LIFECYCLE_OUTPUT to if (candidate.name == "changed") changed else template)
        }
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val contents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, base, index, template.content, sheet.id.value)
        }
        val before = base.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents)))
        val renamed = before.copy(dataModels = before.dataModels + (model.id to model.copy(name = "renamed")))
        assertTrue(calculatedTransitionIsValid(before, renamed, rules))
        val changedModel = model.copy(columns = model.columns.map { if (it.id == property.id) property.copy(formula = "=42") else it })
        val declarationChanged = before.copy(dataModels = before.dataModels + (model.id to changedModel))
        val changedContents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(changed, declarationChanged, index, "=42", sheet.id.value)
        }
        val replacement = declarationChanged.replaceSheet(sheet.copy(name = "changed", content = TabularContent(
            sheet.tabularContent.rows, sheet.tabularContent.columns, changedContents,
        )))
        assertTrue(calculatedTransitionIsValid(before, replacement, rules))
        assertFalse(calculatedTransitionIsValid(before, replacement.replaceSheet(sheet.copy(name = "changed")), rules))
    }

    @Test
    fun `declaration filtering compares decoded text and retains complete prepared bytes`() {
        val workbook = lifecycleBoundWorkbook(lifecycleWorkbook())
        val model = workbook.dataModels.getValue(LIFECYCLE_MODEL)
        val declaration = (model.columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn).formula
        val template = PreparedModelFormula(declaration)
        val stale = PreparedModelFormula("=stale")

        assertEquals(mapOf(LIFECYCLE_OUTPUT to template), retainDeclaredCalculatedTemplates(
            model, mapOf(LIFECYCLE_OUTPUT to template, "unknown" to stale), ::preparedModelTemplateIsValid,
        ))
        assertEquals(emptyMap(), retainDeclaredCalculatedTemplates(model, mapOf(LIFECYCLE_OUTPUT to stale), ::preparedModelTemplateIsValid))
        assertEquals(null, retainDeclaredCalculatedTemplates(model, null as Map<String, PreparedModelFormula>?, ::preparedModelTemplateIsValid))
    }

    @Test
    fun `prepared lifecycle reconciles retries before checking historical authority`() {
        val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
        val base = initial.removeSheet(initial.sheetsInOrder.last().id)
        val sheet = base.sheetsInOrder.first()
        val declaration = (base.dataModels.getValue(LIFECYCLE_MODEL).columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn).formula
        val template = PreparedModelFormula(declaration)
        val rules = preparedCalculatedTemplates { mapOf(LIFECYCLE_OUTPUT to template) }
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val contents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, base, index, template.content, sheet.id.value)
        }
        val before = base.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents)))
        val row = RowId.generate()
        val after = before.replaceSheet(sheet.copy(content = TabularContent(
            sheet.tabularContent.rows + row, sheet.tabularContent.columns,
            contents + (CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, before, sheet.tabularContent.rows.size, declaration, sheet.id.value)),
        )))

        assertEquals(after, reconcileCalculatedLifecycle(before, before, after, rules))
        assertEquals(after, reconcileCalculatedLifecycle(after, before, after, rules))
        val forged = after.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, emptyMap())))
        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE,
            assertFailsWith<WorkbookApplicationException> { reconcileCalculatedLifecycle(before, before, forged, rules) }.error)
    }

    @Test
    fun `prepared transition retains historical bytes and derives only new rows`() {
        val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
        val base = initial.removeSheet(initial.sheetsInOrder.last().id)
        val sheet = base.sheetsInOrder.first()
        val declaration = (base.dataModels.getValue(LIFECYCLE_MODEL).columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn).formula
        val template = PreparedModelFormula(declaration)
        val rules = preparedCalculatedTemplates { mapOf(LIFECYCLE_OUTPUT to template) }
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val contents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, base, index, template.content, sheet.id.value)
        }
        val before = base.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents)))
        val row = RowId.generate()
        val reordered = before.replaceSheet(sheet.copy(content = TabularContent(
            listOf(row) + sheet.tabularContent.rows.reversed(), sheet.tabularContent.columns,
            contents + (CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, before, 0, declaration, sheet.id.value)),
        )))

        assertTrue(calculatedTransitionIsValid(emptyWorkbookState(), before, rules))
        assertTrue(calculatedTransitionIsValid(before, reordered, rules))
        val missing = before.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, emptyMap())))
        assertFalse(calculatedTransitionIsValid(missing, before, rules))
        val forged = before.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns,
            contents + (CellCoordinate(sheet.tabularContent.rows.first(), output) to "forged"))))
        assertFalse(calculatedTransitionIsValid(before, forged, rules))
        assertFalse(calculatedTransitionIsValid(before, before, preparedCalculatedTemplates { mapOf(LIFECYCLE_OUTPUT to PreparedModelFormula("bad")) }))
    }
}
