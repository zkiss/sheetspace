package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFailsWith

class SqliteWorkbookStoreInputValidationTest {
    @Test
    fun `store rejects unsupported manifests and invalid write requests`() = withSqliteStore { store ->
        val first = testDocument(TEST_SHEET_1, "Inputs")
        val second = testDocument(TEST_SHEET_2, "Outputs")
        assertFailsWith<IllegalArgumentException> { store.saveWorkbook(testWorkbookOf(first).copy(manifest = WorkbookManifest(version = WORKBOOK_SCHEMA_VERSION + 1, sheetIds = listOf(first.id)))) }
        store.saveWorkbook(testWorkbookOf(first, second))
        assertFailsWith<IllegalArgumentException> { store.writeCells(listOf(ExpectedSheetRevision(first.id.value, 0), ExpectedSheetRevision(first.id.value, 0)), listOf(first.cellWrite("A1", "one"))) }
        assertFailsWith<IllegalArgumentException> { store.writeCells(listOf(ExpectedSheetRevision(first.id.value, 0)), emptyList()) }
        assertFailsWith<NoSuchElementException> { store.updateSheetZOrder(listOf(SheetZOrderWrite(ExpectedSheetRevision("00000000-0000-0000-0000-000000000099", 0), 1))) }
        assertFailsWith<SheetRevisionConflict> { store.updateSheetZOrder(listOf(SheetZOrderWrite(ExpectedSheetRevision(first.id.value, 1), 1))) }
    }
}
