package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteWorkbookStoreZOrderTest {
    private val unrelatedSheetId = "00000000-0000-0000-0000-000000000003"

    @Test
    fun `z-order write updates all affected revisions in one transaction`() = withSqliteStore { store ->
        store.saveWorkbook(
            testWorkbookOf(
                testDocument(TEST_SHEET_1, "Inputs", FrameState(zIndex = 1)),
                testDocument(TEST_SHEET_2, "Outputs", FrameState(zIndex = 2)),
                testDocument(unrelatedSheetId, "Notes", FrameState(zIndex = 3)),
            ),
        )

        val updated = store.updateSheetZOrder(
            listOf(
                SheetZOrderWrite(ExpectedSheetRevision(TEST_SHEET_1, 0), 2),
                SheetZOrderWrite(ExpectedSheetRevision(TEST_SHEET_2, 0), 1),
            ),
        )

        assertEquals(listOf(1L, 1L), updated.map(SheetDocument::revision))
        assertEquals(listOf(2, 1), updated.map { it.frame.zIndex })
        assertEquals(0, store.loadSheet(SheetId(unrelatedSheetId))?.revision)
    }

    @Test
    fun `stale affected revision rolls back every z-order write`() = withSqliteStore { store ->
        store.saveWorkbook(
            testWorkbookOf(
                testDocument(TEST_SHEET_1, "Inputs", FrameState(zIndex = 1)),
                testDocument(TEST_SHEET_2, "Outputs", FrameState(zIndex = 2)),
            ),
        )
        store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_2, 0)) { workbook ->
            val outputs = workbook.documents.getValue(SheetId(TEST_SHEET_2))
            workbook.replaceSheet(outputs.rename("New Outputs"))
        }

        val conflict = assertFailsWith<SheetRevisionConflict> {
            store.updateSheetZOrder(
                listOf(
                    SheetZOrderWrite(ExpectedSheetRevision(TEST_SHEET_1, 0), 2),
                    SheetZOrderWrite(ExpectedSheetRevision(TEST_SHEET_2, 0), 1),
                ),
            )
        }

        assertEquals(TEST_SHEET_2, conflict.sheetId)
        val workbook = store.loadWorkbookBundle()
        assertEquals(1, workbook.documents.getValue(SheetId(TEST_SHEET_1)).frame.zIndex)
        assertEquals(2, workbook.documents.getValue(SheetId(TEST_SHEET_2)).frame.zIndex)
        assertEquals(0, workbook.documents.getValue(SheetId(TEST_SHEET_1)).revision)
    }
}
