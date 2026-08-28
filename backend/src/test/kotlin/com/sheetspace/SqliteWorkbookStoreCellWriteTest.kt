package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteWorkbookStoreCellWriteTest {
    @Test
    fun `prepared batch cell write changes one sheet revision and leaves manifest untouched`() =
        withSqliteStore { store ->
            val first = testDocument(TEST_SHEET_1, "Inputs")
            val second = testDocument(TEST_SHEET_2, "Outputs")
            store.saveWorkbook(testWorkbookOf(first, second))
            val firstContent = first.tabularContent

            val updated = store.writeCells(
                ExpectedSheetRevision(TEST_SHEET_1, 0),
                listOf(
                    CellWrite(firstContent.coordinateAt("A1")!!, "raw"),
                    CellWrite(firstContent.coordinateAt("B2")!!, "=A1"),
                ),
            )

            assertEquals(mapOf("A1" to "raw", "B2" to "=A1"), updated.tabularContent.cells)
            assertEquals(1, updated.revision)
            assertEquals(0, store.loadSheet(SheetId(TEST_SHEET_2))!!.revision)
            assertEquals(0, store.loadManifest().revision)
        }

    @Test
    fun `canonical formula content survives sqlite round trip byte for byte`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Outputs")
        val canonical =
            "= SUM( 'sheet-inputs'!@[\$column-a,row-a]:@[column-b,\$row-b], @[column-c,row-c] )"
        store.saveWorkbook(testWorkbookOf(sheet))

        store.writeCells(
            ExpectedSheetRevision(TEST_SHEET_1, 0),
            listOf(CellWrite(sheet.tabularContent.coordinateAt("A1")!!, canonical)),
        )

        assertEquals(canonical, store.loadSheet(SheetId(TEST_SHEET_1))!!.tabularContent.cells.getValue("A1"))
    }

    @Test
    fun `stale batch cell write is atomic`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val coordinate = sheet.tabularContent.coordinateAt("A1")!!
        store.writeCells(
            ExpectedSheetRevision(TEST_SHEET_1, 0),
            listOf(CellWrite(coordinate, "newer")),
        )

        assertFailsWith<SheetRevisionConflict> {
            store.writeCells(
                ExpectedSheetRevision(TEST_SHEET_1, 0),
                listOf(CellWrite(coordinate, "stale")),
            )
        }

        assertEquals("newer", store.loadSheet(SheetId(TEST_SHEET_1))!!.tabularContent.cells.getValue("A1"))
    }
}
