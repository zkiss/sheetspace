package com.sheetspace

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class CustomFunctionRoundtripTest {
    private val definitions = listOf(
        CustomFunction("zero", emptyList(), "not a formula", mapOf(TEST_SHEET_1 to "=@old!identity", TEST_SHEET_2 to "=@other!identity")),
        CustomFunction("many", listOf(CustomFunctionParameter("a", "int"), CustomFunctionParameter("b", "float"), CustomFunctionParameter("c", "string"), CustomFunctionParameter("d", "boolean")), "=UNKNOWN(a,", mapOf(TEST_SHEET_1 to "=UNKNOWN(@stable,", TEST_SHEET_2 to "=UNKNOWN(@different,")),
        CustomFunction("valid", emptyList(), "=SUM(1, 2)"),
    )

    @Test
    fun `replacement and incremental updates survive reopening and unrelated writes`() {
        val path = tempSqlitePath()
        try {
            val sheet = testDocument(TEST_SHEET_1, "Inputs", tabular = TabularContent(cells = mapOf("A1" to "=zero()")))
            SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(testWorkbookOf(sheet).copy(functions = definitions))
            }
            SqliteWorkbookStore(path).use { store ->
                assertEquals(definitions, store.loadWorkbookBundle().functions)
                store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", "=many(1,2,3,4)")))
                store.updateWorkbook { it.replaceSheet(it.findSheet(sheet.id)!!.updateFrame { frame -> frame.update(position = WorkspacePosition(7.0, 8.0)) }) }
                assertEquals(definitions, store.loadWorkbookBundle().functions)
                store.updateWorkbook { it.copy(functions = definitions.drop(1) + definitions.first().copy(body = "=changed")) }
                assertEquals(definitions.drop(1) + definitions.first().copy(body = "=changed"), store.loadWorkbookBundle().functions)
                store.updateWorkbook { it.copy(functions = emptyList()) }
                assertEquals(emptyList(), store.loadWorkbookBundle().functions)
                store.saveWorkbook(store.loadWorkbookBundle().copy(functions = definitions))
            }
            SqliteWorkbookStore(path).use { store -> assertEquals(definitions, store.loadWorkbookBundle().functions) }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }

    @Test
    fun `both store paths independently add update and remove functions`() {
        val path = tempSqlitePath()
        try {
            SqliteWorkbookStore(path).use { it.saveWorkbook(testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs"))) }
            val updated = definitions.map { it.copy(body = it.body + " edited") }
            for (replacement in listOf(true, false)) {
                for (expected in listOf(definitions, updated, emptyList())) {
                    SqliteWorkbookStore(path).use { store ->
                        if (replacement) store.saveWorkbook(store.loadWorkbookBundle().copy(functions = expected))
                        else store.updateWorkbook { it.copy(functions = expected) }
                    }
                    SqliteWorkbookStore(path).use { assertEquals(expected, it.loadWorkbookBundle().functions) }
                }
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }

    @Test
    fun `bundle snapshot preserves functions and lifecycle rejects alterations`() {
        val initial = testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs")).copy(functions = definitions)
        val encoded = Json.encodeToString(WorkbookReadTransportAdapter.bundle(initial))
        val decoded = Json.decodeFromString<WorkbookBundleResponse>(encoded).toLifecycleWorkbook()
        assertEquals(initial, decoded)
        assertFalse(sameWorkbookContent(initial, initial.copy(functions = emptyList())))
        val changed = initial.replaceSheet(initial.sheetsInOrder.first().rename("Changed"))
        assertEquals(changed.functions, reconcileModelLifecycle(initial, initial, changed).functions)
        assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(initial, initial, changed.copy(functions = emptyList())) }
        assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(initial, initial.copy(functions = emptyList()), initial) }
    }
}
