package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class RecordReplayGuardTest {
    @Test
    fun `a caller supplied historic calculated row without server provenance is never restoration authority`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val content = scenario.target.tabularContent
        val output = scenario.target.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val forged = scenario.before.replaceSheet(scenario.target.copy(content = TabularContent(
            content.rows + scenario.row, content.columns, content.cellContents + (CellCoordinate(scenario.row, output) to "=999"),
        )))
        val request = scenario.replayRequest("redo").copy(before = WorkbookReadTransportAdapter.bundle(forged))
        assertRejected(scenario, WorkbookApplicationError.INVALID_MODEL_RECORD) { scenario.replay(request) }
        assertEquals(0, admissionReceipts(store))
    }

    @Test
    fun `fresh directions require original server provenance and the exact source endpoint`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        assertRejected(scenario, WorkbookApplicationError.INVALID_MODEL_RECORD) { scenario.replay(scenario.replayRequest("redo")) }
        scenario.admit()
        assertRejected(scenario, WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT) { scenario.replay(scenario.replayRequest("redo")) }
        assertRejected(scenario, WorkbookApplicationError.INVALID_MODEL_RECORD) {
            scenario.app.replayRecord(scenario.other.id.value, scenario.row.value, scenario.replayRequest("undo"))
        }
        assertRejected(scenario, WorkbookApplicationError.INVALID_MODEL_RECORD) {
            scenario.app.replayRecord(scenario.target.id.value, RowId.generate().value, scenario.replayRequest("undo"))
        }
        scenario.replay(scenario.replayRequest("undo"))
        assertRejected(scenario, WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT) { scenario.replay(scenario.replayRequest("undo")) }
    }

    @Test
    fun `complete guards reject claimed rows formulas model edits and missing or extra dependencies`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val admitted = scenario.admit().workbook
        val request = scenario.replayRequest("undo")
        val target = admitted.documents.getValue(scenario.target.id)
        val changedSheet = target.copy(content = target.tabularContent.updateCell("B1", "=999"))
        val changes = listOf(
            admitted.replaceSheet(changedSheet),
            admitted.replaceSheet(target.copy(content = target.tabularContent.updateCell("A1", "999"))),
            admitted.replaceSheet(target.copy(modelColumnBindings = emptyMap())),
            admitted.replaceSheet(target.copy(modelFormulaBindings = emptyMap())),
            admitted.replaceSheet(target.copy(content = target.tabularContent.appendRow())),
            admitted.copy(dataModels = emptyMap()),
            admitted.copy(dataModels = admitted.dataModels + (java.util.UUID.randomUUID().toString().let { it to DataModel(it, "Extra", emptyList()) })),
            admitted.copy(dataModels = admitted.dataModels.mapValues { (_, model) -> model.copy(name = "Forged") }),
            admitted.copy(dataModels = admitted.dataModels.mapValues { (_, model) -> model.copy(columns = model.columns.map { if (it is CalculatedModelColumn) it.copy(formula = "=999") else it }) }),
            admitted.removeSheet(scenario.untouched.id),
            admitted.addSheet(SheetDocument(id = SheetId.generate(), name = "Extra")),
            admitted.copy(manifest = admitted.manifest.copy(revision = admitted.manifest.revision + 1)),
        )
        changes.forEach { claimed ->
            val failure = assertFailsWith<WorkbookApplicationException> { scenario.replay(request.copy(before = WorkbookReadTransportAdapter.bundle(claimed))) }
            kotlin.test.assertTrue(failure.error in setOf(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT, WorkbookApplicationError.SHEET_NOT_FOUND))
            assertEquals(admitted, store.loadWorkbookBundle())
            assertEquals(0, replayReceipts(store))
        }
    }

    @Test
    fun `current unrelated edits model changes and calculated tampering cannot be overwritten even with fresh guards`() {
        val mutations: List<(AtomicAdmissionScenario) -> Unit> = listOf(
            { s -> s.app.writeOneCell(s.other.id.value, "A1", "777", s.store.loadSheet(s.other.id)!!.revision) },
            { s -> val m = s.app.loadWorkbookBundle().dataModels.getValue(LIFECYCLE_MODEL); s.app.saveDataModel(m.copy(name = "Changed")) },
            { s -> admissionSql(s.store, "UPDATE cells SET raw_content = '=999' WHERE column_id = X'${s.target.modelColumnBindings.getValue(LIFECYCLE_OUTPUT).value.replace("-", "")}'") },
            { s -> admissionSql(s.store, "UPDATE sheet_documents SET model_formula_bindings = '{}' ") },
            { s -> admissionSql(s.store, "DELETE FROM sheet_model_column_bindings") },
            { s -> admissionSql(s.store, "UPDATE data_model_columns SET formula = '=999' WHERE column_kind = 'CALCULATED'") },
            { s -> s.app.createSheet(CreateSheetCommand(name = "Extra")) },
        )
        mutations.forEach { mutate -> withSqliteStore { store ->
            val scenario = AtomicAdmissionScenario(store)
            scenario.admit()
            mutate(scenario)
            assertRejected(scenario, WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT) { scenario.replay(scenario.replayRequest("undo")) }
        } }
    }

    @Test
    fun `stale untouched dependency and missing sheet fail contextually without mutation`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val request = scenario.replayRequest("undo")
        val dependency = scenario.untouched
        scenario.app.writeOneCell(dependency.id.value, "A1", "3", dependency.revision)
        val current = store.loadWorkbookBundle()
        val conflict = assertFailsWith<SheetRevisionConflict> { scenario.replay(request) }
        assertEquals(dependency.id.value, conflict.sheetId)
        assertEquals(dependency.revision, conflict.expectedRevision)
        assertEquals(dependency.revision + 1, conflict.actualRevision)
        assertEquals(current, store.loadWorkbookBundle())
        val guard = scenario.replayRequest("undo")
        scenario.app.deleteSheet(dependency.id.value, dependency.revision + 1)
        val missing = assertFailsWith<WorkbookApplicationException> { scenario.replay(guard) }
        assertEquals(WorkbookApplicationError.SHEET_NOT_FOUND, missing.error)
        assertEquals(dependency.id.value, missing.sheetId)
        assertEquals(0, replayReceipts(store))
    }

    private fun assertRejected(scenario: AtomicAdmissionScenario, expected: WorkbookApplicationError, action: () -> Unit) {
        val before = scenario.store.loadWorkbookBundle()
        val receipts = replayReceipts(scenario.store)
        assertEquals(expected, assertFailsWith<WorkbookApplicationException>(block = action).error)
        assertEquals(before, scenario.store.loadWorkbookBundle())
        assertEquals(receipts, replayReceipts(scenario.store))
    }
}
