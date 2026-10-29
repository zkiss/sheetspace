package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class PreparedCalculatedTransitionTest {
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
