package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class SqliteSheetIdentityHistoryTest {
    @Test
    fun `retired sheet and original axes cannot be restored through lifecycle or aggregate writes`() = withSqliteStore { store ->
        val original = extractionWorkbook()
        val target = original.sheetsInOrder.first()
        val caller = original.sheetsInOrder.last()
        store.saveWorkbook(original)
        val application = DefaultWorkbookApplication(store)
        val before = application.setFunction(original, CustomFunction("reference", emptyList(), "=@${target.name}!A[1]"), null)
        val binding = before.functions.single().bodyBindings.getValue(caller.id.value)
        assertTrue(binding.contains(target.id.value))
        assertTrue(binding.contains(target.tabularContent.rows.first().value))
        assertTrue(binding.contains(target.tabularContent.columns.first().value))
        val removed = application.saveModelLifecycle(before, before.removeSheet(target.id))
        val restored = removed.addSheet(target)

        assertFailsWith<WorkbookApplicationException> { application.saveModelLifecycle(removed, restored) }
        assertFailsWith<WorkbookApplicationException> { store.updateWorkbook { restored } }
        assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(restored) }
        assertEquals(removed, store.loadWorkbookBundle())
        assertEquals(binding, store.loadWorkbookBundle().functions.single().bodyBindings.getValue(caller.id.value))
    }

    @Test
    fun `retired sheet identities cannot be reintroduced by aggregate writes after reopen`() {
        val path = tempSqlitePath()
        val original = testDocument(TEST_SHEET_1, "Original")
        val replacement = testDocument(TEST_SHEET_2, "Replacement")
        try {
            SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(testWorkbookOf(original))
                store.saveWorkbook(testWorkbookOf(replacement))
            }
            SqliteWorkbookStore(path).use { store ->
                val before = store.loadWorkbookBundle()
                assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(testWorkbookOf(original)) }
                assertEquals(before, store.loadWorkbookBundle())
                assertFailsWith<WorkbookApplicationException> { store.updateWorkbook { testWorkbookOf(original) } }
                assertEquals(before, store.loadWorkbookBundle())
                store.saveWorkbook(testWorkbookOf(replacement.copy(name = "Renamed")))
                assertEquals("Renamed", store.loadWorkbookBundle().sheetsInOrder.single().name)
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }
}
