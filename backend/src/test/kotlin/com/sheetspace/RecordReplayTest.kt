package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class RecordReplayTest {
    @Test
    fun `trusted replay does not relax ordinary calculated writes or generic lifecycle restoration`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val admitted = scenario.admit().workbook
        val removed = scenario.replay(scenario.replayRequest("undo")).workbook.toLifecycleWorkbook()
        val rejected = assertFailsWith<WorkbookApplicationException> { scenario.app.saveModelLifecycle(removed, admitted) }
        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejected.error)
        assertEquals(removed, store.loadWorkbookBundle())
        scenario.replay(scenario.replayRequest("redo"))
        val current = store.loadWorkbookBundle()
        val sheet = current.documents.getValue(scenario.target.id)
        val cellWrite = assertFailsWith<WorkbookApplicationException> { scenario.app.writeOneCell(sheet.id.value, "B1", "=999", sheet.revision) }
        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, cellWrite.error)
        assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(current.replaceSheet(sheet.copy(content = sheet.tabularContent.updateCell("B1", "=999")))) }
        assertEquals(current, store.loadWorkbookBundle())
    }

    @Test
    fun `undo and redo preserve tail-derived identities and both recorded orders without sorting again`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val admitted = scenario.admit().workbook
        val sheet = admitted.documents.getValue(scenario.target.id)
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val formula = sheet.tabularContent.cellContents.getValue(CellCoordinate(scenario.row, output))
        assertNotEquals(derivedFormulaRaw(sheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT), admitted, 0, "=@A[2]*2", sheet.id.value), formula)

        repeat(2) { cycle ->
            val undo = scenario.replay(scenario.replayRequest("undo"))
            assertFalse(undo.alreadyCommitted)
            assertSemanticEndpoint(scenario.before, undo.workbook.toLifecycleWorkbook())
            val redo = scenario.replay(scenario.replayRequest("redo"))
            val restored = redo.workbook.toLifecycleWorkbook()
            assertFalse(redo.alreadyCommitted)
            assertSemanticEndpoint(admitted, restored)
            assertEquals(formula, restored.documents.getValue(sheet.id).tabularContent.cellContents.getValue(CellCoordinate(scenario.row, output)))
            assertEquals(sheet.revision + (cycle + 1) * 2, restored.documents.getValue(sheet.id).revision)
            assertEquals(scenario.other.revision + 1 + (cycle + 1) * 2, restored.documents.getValue(scenario.other.id).revision)
            assertEquals(scenario.untouched, restored.documents.getValue(scenario.untouched.id))
            assertEquals(admitted.manifest, restored.manifest)
            assertEquals(restored, store.loadWorkbookBundle())
        }
        assertEquals(4, replayReceipts(store))
    }

    @Test
    fun `receipt retries confirm current state rather than replaying old directions or original admission`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val undo = scenario.replayRequest("undo")
        val removed = scenario.replay(undo)
        assertEquals(removed.copy(alreadyCommitted = true), scenario.replay(undo))
        assertEquals(removed.workbook.toLifecycleWorkbook(), scenario.admit().workbook)
        val redo = scenario.replayRequest("redo")
        val restored = scenario.replay(redo)
        assertEquals(restored.copy(alreadyCommitted = true), scenario.replay(redo))
        assertEquals(restored.copy(operationId = undo.operationId, alreadyCommitted = true), scenario.replay(undo))
        val removedAgain = scenario.replay(scenario.replayRequest("undo"))
        assertEquals(removedAgain.copy(operationId = redo.operationId, alreadyCommitted = true), scenario.replay(redo))
        scenario.app.deleteSheet(scenario.target.id.value, store.loadSheet(scenario.target.id)!!.revision)
        assertTrue(scenario.replay(redo).alreadyCommitted)
        assertEquals(store.loadWorkbookBundle(), scenario.replay(undo).workbook.toLifecycleWorkbook())
        assertEquals(3, replayReceipts(store))
        assertEquals(1, admissionReceipts(store))
    }

    private fun assertSemanticEndpoint(expected: WorkbookState, actual: WorkbookState) {
        assertEquals(expected.copy(documents = expected.documents.mapValues { (id, sheet) -> sheet.copy(revision = actual.documents.getValue(id).revision) }), actual)
    }
}
