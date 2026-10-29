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
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, withTarget, index)
        }
        val before = withTarget.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents)))
        val replacement = before.removeSheet(target.id).addSheet(target.copy(id = SheetId("replacement")))
        val rules = preparedCalculatedTemplates { candidate -> if (candidate.id == sheet.id) mapOf(LIFECYCLE_OUTPUT to template) else null }

        assertEquals(fixture.getValue("expected").jsonPrimitive.content, derivedPreparedFormulaRaw(template, before, 1))
        assertTrue(calculatedTransitionIsValid(before, replacement, rules))
        assertEquals(contents, replacement.documents.getValue(sheet.id).tabularContent.cellContents)
        val dead = before.removeSheet(target.id)
        val newTarget = SheetDocument(SheetId.generate(), name = "Inputs", content = TabularContent(
            listOf(RowId.generate()), listOf(ColumnId.generate()), emptyMap(),
        ))
        var enforce = false
        SqliteWorkbookStore.inMemory(calculatedAdmission = { current, updated ->
            if (enforce) rejectCalculatedOverrides(current, updated, rules)
        }).use { store ->
            store.saveWorkbook(dead)
            enforce = true
            store.updateWorkbook(null) { it.addSheet(newTarget) }
            assertEquals(contents, store.loadWorkbookBundle().documents.getValue(sheet.id).tabularContent.cellContents)
        }
    }

    @Test
    fun `renaming retains historical bytes while changing declaration derives replacements`() {
        val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
        val base = initial.removeSheet(initial.sheetsInOrder.last().id)
        val sheet = base.sheetsInOrder.first()
        val model = base.dataModels.getValue(LIFECYCLE_MODEL)
        val property = model.columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn
        val template = PreparedModelFormula(StoredFormulaCodec.encode(StoredFormula(property.formula, emptyList())))
        val changed = PreparedModelFormula(StoredFormulaCodec.encode(StoredFormula("=42", emptyList())))
        val rules = preparedCalculatedTemplates { candidate ->
            mapOf(LIFECYCLE_OUTPUT to if (candidate.name == "changed") changed else template)
        }
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val contents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, base, index)
        }
        val before = base.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents)))
        val renamed = before.copy(dataModels = before.dataModels + (model.id to model.copy(name = "renamed")))
        assertTrue(calculatedTransitionIsValid(before, renamed, rules))
        val changedModel = model.copy(columns = model.columns.map { if (it.id == property.id) property.copy(formula = "=42") else it })
        val declarationChanged = before.copy(dataModels = before.dataModels + (model.id to changedModel))
        val changedContents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(changed, declarationChanged, index)
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
        val template = PreparedModelFormula(StoredFormulaCodec.encode(StoredFormula(declaration, emptyList())))
        val stale = PreparedModelFormula(StoredFormulaCodec.encode(StoredFormula("=stale", emptyList())))

        assertEquals(mapOf(LIFECYCLE_OUTPUT to template), retainDeclaredCalculatedTemplates(
            model, mapOf(LIFECYCLE_OUTPUT to template, "unknown" to stale), ::preparedModelTemplateIsValid,
        ))
        assertEquals(emptyMap(), retainDeclaredCalculatedTemplates(model, mapOf(LIFECYCLE_OUTPUT to stale), ::preparedModelTemplateIsValid))
        assertEquals(null, retainDeclaredCalculatedTemplates(model, null as Map<String, PreparedModelFormula>?, ::preparedModelTemplateIsValid))
    }

    @Test
    fun `empty continuing sheets retain their persisted template and admission rejects forged replacement`() {
        val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
        val base = initial.removeSheet(initial.sheetsInOrder.last().id)
        val sheet = base.sheetsInOrder.first()
        val empty = base.replaceSheet(sheet.copy(content = TabularContent(emptyList(), sheet.tabularContent.columns, emptyMap())))
        val declaration = (base.dataModels.getValue(LIFECYCLE_MODEL).columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn).formula
        val template = PreparedModelFormula(StoredFormulaCodec.encode(StoredFormula(declaration, emptyList())))
        val other = PreparedModelFormula(StoredFormulaCodec.encode(StoredFormula(declaration + " ", emptyList())))
        val rules = preparedCalculatedTemplates { candidate ->
            mapOf(LIFECYCLE_OUTPUT to if (candidate === empty.documents.getValue(sheet.id)) template else other)
        }
        val replacement = empty.replaceSheet(sheet.copy(content = TabularContent(emptyList(), sheet.tabularContent.columns, emptyMap())))

        rejectCalculatedOverrides(empty, empty, rules)
        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE,
            assertFailsWith<WorkbookApplicationException> { rejectCalculatedOverrides(empty, replacement, rules) }.error)
    }

    @Test
    fun `prepared lifecycle reconciles retries before checking historical authority`() {
        val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
        val base = initial.removeSheet(initial.sheetsInOrder.last().id)
        val sheet = base.sheetsInOrder.first()
        val declaration = (base.dataModels.getValue(LIFECYCLE_MODEL).columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn).formula
        val template = PreparedModelFormula(StoredFormulaCodec.encode(StoredFormula(declaration, emptyList())))
        val rules = preparedCalculatedTemplates { mapOf(LIFECYCLE_OUTPUT to template) }
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val contents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, base, index)
        }
        val before = base.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents)))
        val row = RowId.generate()
        val after = before.replaceSheet(sheet.copy(content = TabularContent(
            sheet.tabularContent.rows + row, sheet.tabularContent.columns,
            contents + (CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, before, sheet.tabularContent.rows.size)),
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
        val template = PreparedModelFormula(StoredFormulaCodec.encode(StoredFormula(declaration, emptyList())))
        val rules = preparedCalculatedTemplates { mapOf(LIFECYCLE_OUTPUT to template) }
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val contents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, base, index)
        }
        val before = base.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents)))
        val row = RowId.generate()
        val reordered = before.replaceSheet(sheet.copy(content = TabularContent(
            listOf(row) + sheet.tabularContent.rows.reversed(), sheet.tabularContent.columns,
            contents + (CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, before, 0)),
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
