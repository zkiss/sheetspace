package com.sheetspace

import java.util.Collections
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteWorkbookStoreRevisionTest {
    @Test
    fun `non-revision updates serialize concurrent workbook transforms`() = withSqliteStore { store ->
        val gate = CountDownLatch(1)
        val workers = listOf(
            testDocument(TEST_SHEET_1, "Inputs"),
            testDocument(TEST_SHEET_2, "Outputs"),
        ).map { sheet ->
            thread {
                gate.await()
                store.updateWorkbook { workbook ->
                    val nextZIndex = (workbook.documents.values.maxOfOrNull { it.frame.zIndex } ?: 0) + 1
                    workbook.addSheet(sheet.updateFrame { it.update(zIndex = nextZIndex) })
                }
            }
        }

        gate.countDown()
        workers.forEach { it.join() }

        val sheets = store.loadWorkbookBundle().sheetsInOrder
        assertEquals(setOf(TEST_SHEET_1, TEST_SHEET_2), sheets.map { it.id.value }.toSet())
        assertEquals(setOf(1, 2), sheets.map { it.frame.zIndex }.toSet())
    }

    @Test
    fun `revisioned update increments once and rejects stale revisions`() = withSqliteStore { store ->
        store.saveWorkbook(testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs")))
        val updated = store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook ->
            val sheet = workbook.documents.getValue(SheetId(TEST_SHEET_1))
            workbook.replaceSheet(
                sheet.updateTabularContent { it.copy(cells = mapOf("A1" to "newer value")) },
            )
        }

        val conflict = assertFailsWith<SheetRevisionConflict> {
            store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook ->
                val sheet = workbook.documents.getValue(SheetId(TEST_SHEET_1))
                workbook.replaceSheet(
                    sheet.updateTabularContent { it.copy(cells = mapOf("A1" to "stale value")) },
                )
            }
        }

        assertEquals(1, updated.sheetsInOrder.single().revision)
        assertEquals(1, conflict.actualRevision)
        assertEquals(
            "newer value",
            store.loadWorkbookBundle().sheetsInOrder.single().tabularContent.cells.getValue("A1"),
        )
    }

    @Test
    fun `concurrent same revision updates yield one save and one conflict`() = withSqliteStore { store ->
        store.saveWorkbook(testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs")))
        val gate = CountDownLatch(1)
        val outcomes = Collections.synchronizedList(mutableListOf<String>())
        val workers = listOf("first", "second").map { value ->
            thread {
                gate.await()
                try {
                    store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook ->
                        val sheet = workbook.documents.getValue(SheetId(TEST_SHEET_1))
                        workbook.replaceSheet(
                            sheet.updateTabularContent { it.copy(cells = mapOf("A1" to value)) },
                        )
                    }
                    outcomes += "saved"
                } catch (_: SheetRevisionConflict) {
                    outcomes += "conflict"
                }
            }
        }

        gate.countDown()
        workers.forEach { it.join() }

        assertEquals(listOf("conflict", "saved"), outcomes.sorted())
        assertEquals(1, store.loadWorkbookBundle().sheetsInOrder.single().revision)
    }

    @Test
    fun `revisioned deletion succeeds once and rejects stale deletion`() = withSqliteStore { store ->
        store.saveWorkbook(testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs")))
        store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook ->
            val sheet = workbook.documents.getValue(SheetId(TEST_SHEET_1))
            workbook.replaceSheet(
                sheet.updateTabularContent { it.copy(cells = mapOf("A1" to "newer")) },
            )
        }

        val stale = assertFailsWith<SheetRevisionConflict> {
            store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook ->
                workbook.removeSheet(SheetId(TEST_SHEET_1))
            }
        }
        val deleted = store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 1)) { workbook ->
            workbook.removeSheet(SheetId(TEST_SHEET_1))
        }

        assertEquals(1, stale.actualRevision)
        assertEquals(emptyList(), deleted.sheetsInOrder)
        assertEquals(1, deleted.manifest.revision)
    }
}
