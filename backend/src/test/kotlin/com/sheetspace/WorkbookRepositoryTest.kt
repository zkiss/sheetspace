package com.sheetspace

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkbookRepositoryTest {
    @Test
    fun `loads empty workbook when database has no saved state`() {
        val repo = createRepo()

        assertEquals(emptyWorkbook(), repo.loadWorkbook())
    }

    @Test
    fun `persists and reloads workbook state including raw formulas and positions`() {
        val repo = createRepo()
        val workbook = Workbook(
            sheets = listOf(
                Sheet(
                    id = "sheet-1",
                    name = "Inputs",
                    position = WorkspacePosition(12.5, -8.25),
                    zIndex = 7,
                    rowCount = 25,
                    columnCount = 14,
                    cells = mapOf(
                        "A1" to CellContent("=SUM(B1:B2)\n"),
                        "B1" to CellContent("4"),
                    ),
                ),
            ),
        )

        repo.saveWorkbook(workbook)

        assertEquals(workbook, repo.loadWorkbook())
    }

    @Test
    fun `saves workbook as replaceable sheet rows`() {
        val repo = createRepo()
        val first = Sheet(id = "sheet-1", name = "Inputs")
        val second = Sheet(id = "sheet-2", name = "Outputs")

        repo.saveWorkbook(Workbook(sheets = listOf(first, second)))
        repo.saveWorkbook(Workbook(sheets = listOf(second.copy(name = "Renamed Outputs"))))

        assertEquals(listOf(second.copy(name = "Renamed Outputs")), repo.loadWorkbook().sheets)
    }

    @Test
    fun `supports sheet-level updates and keeps formula display artifacts out of persistence`() {
        val repo = createRepo()

        repo.createSheet(Sheet(id = "sheet-1", name = "Inputs"))
        repo.updateCell("sheet-1", "A1", "=SUM(B1:B2)")
        repo.updateCell("sheet-1", "B1", "2")
        repo.updateCell("sheet-1", "B2", "3")
        repo.renameSheet("sheet-1", "Renamed Inputs")
        repo.updateSheetPosition("sheet-1", WorkspacePosition(80.0, 120.0))
        repo.updateSheetZIndex("sheet-1", 4)
        repo.appendRow("sheet-1")
        repo.appendColumn("sheet-1")

        val reloaded = repo.loadWorkbook()
        val sheet = reloaded.sheets.single()
        assertEquals("Renamed Inputs", sheet.name)
        assertEquals(21, sheet.rowCount)
        assertEquals(11, sheet.columnCount)
        assertEquals(WorkspacePosition(80.0, 120.0), sheet.position)
        assertEquals(4, sheet.zIndex)
        assertEquals("=SUM(B1:B2)", sheet.cells.getValue("A1").raw)
        assertFalse(sheet.cells.containsKey("A1_display"))
    }

    @Test
    fun `enforces sheet name trimming and uniqueness for sheet creation`() {
        val repo = createRepo()

        repo.createSheet(Sheet(id = "sheet-1", name = "  Inputs  "))
        repo.createSheet(Sheet(id = "sheet-2", name = "Inputs"))

        val workbook = repo.loadWorkbook()
        assertEquals(1, workbook.sheets.size)
        assertEquals("Inputs", workbook.sheets.single().name)
    }

    @Test
    fun `stores schema version marker in persistence row`() {
        val repo = createRepo()
        repo.createSheet(Sheet(id = "sheet-1", name = "Inputs"))

        assertEquals(WORKBOOK_SCHEMA_VERSION, repo.loadStoredSchemaVersion())
        assertTrue(repo.loadWorkbook().sheets.isNotEmpty())
    }

    private fun createRepo(): WorkbookRepository {
        val dbPath = Files.createTempFile("sheetspace-workbook", ".sqlite")
        return WorkbookRepository(dbPath)
    }
}
