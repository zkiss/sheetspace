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

    @Test
    fun `replay removes a moved resized sheet but rejects changed content`() {
        val sheet = (createSheetDocument("Extracted") as SheetNameResult.Valid).value
        val before = WorkbookState()
        val after = before.addSheet(sheet)
        val moved = sheet.copy(frame = sheet.frame.copy(position = WorkspacePosition(123.0, 456.0), size = SheetFrameSize(500.0, 400.0)))
        val current = after.replaceSheet(moved)

        assertEquals(before, replayLifecycleWorkbook(current, after, before).copy(manifest = before.manifest))
        val coordinate = CellCoordinate(sheet.tabularContent.rows[0], sheet.tabularContent.columns[0])
        val edited = moved.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, mapOf(coordinate to "changed")))
        assertFailsWith<WorkbookApplicationException> { replayLifecycleWorkbook(after.replaceSheet(edited), after, before) }
    }

    @Test
    fun `undo preserves independent source changes and redo restores the extracted sheet`() {
        val source = (createSheetDocument("Source") as SheetNameResult.Valid).value
        val extracted = (createSheetDocument("Extracted") as SheetNameResult.Valid).value
        val before = WorkbookState().addSheet(source)
        val after = before.addSheet(extracted)
        val movedSource = source.copy(frame = source.frame.copy(position = WorkspacePosition(20.0, 30.0)))
        val movedExtracted = extracted.copy(frame = extracted.frame.copy(position = WorkspacePosition(40.0, 50.0)))
        val current = after.replaceSheet(movedSource).replaceSheet(movedExtracted)

        val undone = replayLifecycleWorkbook(current, after, before)
        assertEquals(movedSource.frame, undone.documents.getValue(source.id).frame)
        val redone = replayLifecycleWorkbook(undone, before, after)
        assertEquals(movedSource.frame, redone.documents.getValue(source.id).frame)
        assertEquals(extracted, redone.documents.getValue(extracted.id))
    }

    @Test
    fun `moving a sheet does not conceal other changes when replay removes it`() {
        val sheet = (createSheetDocument("Extracted") as SheetNameResult.Valid).value
        val before = WorkbookState()
        val after = before.addSheet(sheet)
        val changed = sheet.copy(name = "Changed", frame = sheet.frame.copy(position = WorkspacePosition(20.0, 30.0)))

        assertFailsWith<WorkbookApplicationException> { replayLifecycleWorkbook(after.replaceSheet(changed), after, before) }
    }
}
