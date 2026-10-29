package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PreparedCalculatedTransitionTest {
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
