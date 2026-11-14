package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class LifecycleWorkbookDeltaTest {
    @Test
    fun `replay preserves independent cells functions and revisions`() {
        val sheet = (createSheetDocument("Inputs") as SheetNameResult.Valid).value
        val first = CellCoordinate(sheet.tabularContent.rows[0], sheet.tabularContent.columns[0])
        val second = CellCoordinate(sheet.tabularContent.rows[0], sheet.tabularContent.columns[1])
        val before = WorkbookState().addSheet(sheet).copy(functions = listOf(CustomFunction("changed", emptyList(), "=1"), CustomFunction("other", emptyList(), "=2")))
        val afterSheet = sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, mapOf(first to "1")))
        val after = before.replaceSheet(afterSheet).copy(functions = listOf(CustomFunction("changed", emptyList(), "=3"), before.functions[1]))
        val currentSheet = afterSheet.copy(revision = 7, content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, mapOf(first to "1", second to "independent")))
        val current = after.replaceSheet(currentSheet).copy(manifest = after.manifest.copy(revision = 10), functions = listOf(after.functions[0], before.functions[1].copy(body = "=4")))

        val result = replayLifecycleWorkbook(current, after, before)
        assertEquals(mapOf(second to "independent"), result.documents.getValue(sheet.id).tabularContent.cellContents)
        assertEquals(7, result.documents.getValue(sheet.id).revision)
        assertEquals(10, result.manifest.revision)
        assertEquals(current.functions, result.functions)
    }

    @Test
    fun `replay preserves independently edited declaration`() {
        val old = CustomFunction("f", emptyList(), "=1")
        val before = WorkbookState(functions = listOf(old))
        val after = before.copy(functions = listOf(old.copy(bodyBindings = mapOf("sheet" to "bound"))))
        val current = after.copy(functions = listOf(after.functions.single().copy(body = "=2")))
        assertEquals(current.functions, replayLifecycleWorkbook(current, after, before).functions)
    }

    @Test
    fun `replay restores exact sheet identities and rejects changed order`() {
        val sheet = (createSheetDocument("Extracted") as SheetNameResult.Valid).value
        val before = WorkbookState()
        val after = before.addSheet(sheet)
        assertEquals(before, replayLifecycleWorkbook(after, after, before).copy(manifest = before.manifest))
        val restored = replayLifecycleWorkbook(before, before, after)
        assertEquals(sheet, restored.documents.getValue(sheet.id))
        val other = (createSheetDocument("Other") as SheetNameResult.Valid).value
        assertFailsWith<WorkbookApplicationException> { replayLifecycleWorkbook(after.addSheet(other), after, before) }
    }
}
