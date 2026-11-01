package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals

class SqliteWorkbookStoreStructuralDeletionTest {
    @Test
    fun `first middle and last axis deletions preserve order through repeated reloads`() {
        for (firstIndex in listOf(0, 2, 4)) withSqliteStore { store ->
            val content = TabularContent(rowCount = 5, columnCount = 5)
            store.saveWorkbook(testWorkbookOf(testDocument(TEST_SHEET_1, "Sheet", tabular = content)))
            var rows = content.rows
            var columns = content.columns
            for (index in listOf(firstIndex, 1, 0)) {
                rows = rows.filterIndexed { position, _ -> position != index }
                columns = columns.filterIndexed { position, _ -> position != index }
                store.updateWorkbook { workbook ->
                    val sheet = workbook.documents.getValue(SheetId(TEST_SHEET_1))
                    workbook.replaceSheet(sheet.updateTabularContent { TabularContent(rows, columns, emptyMap()) })
                }
                val loaded = store.loadSheet(SheetId(TEST_SHEET_1))!!.content as TabularContent
                assertEquals(rows, loaded.rows)
                assertEquals(columns, loaded.columns)
            }
        }
    }
}
