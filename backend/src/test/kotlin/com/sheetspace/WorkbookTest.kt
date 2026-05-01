package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class WorkbookTest {
    @Test
    fun `empty workbook starts with zero sheets`() {
        assertEquals(Workbook(version = 1, sheets = emptyList()), emptyWorkbook())
    }

    @Test
    fun `new sheets use MVP defaults and preserve caller position`() {
        val result = createSheet(
            id = "sheet-1",
            name = "Inputs",
            position = WorkspacePosition(x = 12.0, y = 24.0),
        )

        val sheet = assertIs<SheetNameResult.Valid<Sheet>>(result).value
        assertEquals("sheet-1", sheet.id)
        assertEquals("Inputs", sheet.name)
        assertEquals(WorkspacePosition(x = 12.0, y = 24.0), sheet.position)
        assertEquals(DEFAULT_COLUMN_COUNT, sheet.columnCount)
        assertEquals(DEFAULT_ROW_COUNT, sheet.rowCount)
        assertEquals(emptyMap(), sheet.cells)
    }

    @Test
    fun `sheet names must be non-empty and unique`() {
        val existingSheet = assertIs<SheetNameResult.Valid<Sheet>>(
            createSheet(id = "sheet-1", name = "Inputs"),
        ).value

        assertEquals(
            SheetNameResult.Invalid(SheetNameError.EMPTY),
            validateSheetName("   ", listOf(existingSheet)),
        )
        assertEquals(
            SheetNameResult.Invalid(SheetNameError.DUPLICATE),
            validateSheetName("Inputs", listOf(existingSheet)),
        )
        assertEquals(
            SheetNameResult.Valid("Inputs"),
            validateSheetName(" Inputs ", listOf(existingSheet), currentSheetId = "sheet-1"),
        )
    }

    @Test
    fun `renaming a sheet preserves raw formula text`() {
        val originalSheet = Sheet(
            id = "sheet-1",
            name = "Inputs",
            cells = mapOf("A1" to CellContent(raw = " =SUM( 'Old Name'!A1 )\n")),
        )
        val workbook = Workbook(sheets = listOf(originalSheet))

        val renamed = assertIs<WorkbookResult.Valid>(
            renameSheet(workbook, "sheet-1", "Renamed"),
        ).workbook

        assertEquals("Renamed", renamed.sheets.single().name)
        assertEquals(" =SUM( 'Old Name'!A1 )\n", renamed.sheets.single().cells.getValue("A1").raw)
    }

    @Test
    fun `append row and column preserve existing cell contents`() {
        val sheet = Sheet(
            id = "sheet-1",
            name = "Inputs",
            cells = mapOf("A1" to CellContent(raw = "42")),
        )

        assertEquals(21, appendRow(sheet).rowCount)
        assertEquals(sheet.cells, appendRow(sheet).cells)
        assertEquals(11, appendColumn(sheet).columnCount)
        assertEquals(sheet.cells, appendColumn(sheet).cells)
    }
}
