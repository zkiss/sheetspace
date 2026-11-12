package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class RecordDeletionReplayInterveningTest {
    @Test
    fun `deletion replay restores actual endpoints after edits and another admission`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val admissionBefore = scenario.before
        val admissionAfter = scenario.admit().workbook
        val admittedSheet = admissionAfter.documents.getValue(scenario.target.id)
        val output = admittedSheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val coordinate = CellCoordinate(scenario.row, output)
        val formula = admittedSheet.tabularContent.cellContents.getValue(coordinate)
        assertEquals(scenario.row, admittedSheet.tabularContent.rows.first())
        assertNotEquals(derivedFormulaRaw(admittedSheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT), admissionAfter, 0, "=@A[2]*2", admittedSheet.id.value), formula)

        scenario.app.writeOneCell(admittedSheet.id.value, "A2", "17", admittedSheet.revision)
        val edited = store.loadSheet(admittedSheet.id)!!
        val cellKey = "${scenario.row.value}\u0000${output.value}"
        store.writePresentation(ExpectedSheetRevision(edited.id.value, edited.revision), listOf(AxisSizeWrite("row", scenario.row.value, 48.0)), listOf(
            FormatWrite("cell", cellKey, properties = mapOf("fontWeight" to kotlinx.serialization.json.JsonPrimitive("bold"))),
        ))
        val beforeSecond = store.loadWorkbookBundle()
        val secondRow = RowId.generate()
        val target = beforeSecond.findSheet(scenario.target.id)!!
        val other = beforeSecond.findSheet(scenario.other.id)!!
        scenario.app.admitRecord(target.id.value, target.revision, secondRow.value, mapOf(LIFECYCLE_INPUT to "9"),
            WorkbookReadTransportAdapter.bundle(beforeSecond), listOf(
                RecordRowOrder(target.id.value, (target.tabularContent.rows + secondRow).map { it.value }),
                RecordRowOrder(other.id.value, other.tabularContent.rows.reversed().map { it.value }),
            ))

        val deletionBefore = store.loadWorkbookBundle()
        val deletionTarget = deletionBefore.findSheet(target.id)!!
        val deletionOther = deletionBefore.findSheet(other.id)!!
        assertNotEquals(admissionAfter, deletionBefore)
        assertEquals(formula, deletionTarget.tabularContent.cellContents.getValue(coordinate))
        assertTrue(secondRow in deletionTarget.tabularContent.rows)
        assertTrue(cellKey in deletionTarget.presentation.formatOverrides.cells)
        val capture = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(deletionBefore), listOf(
            RecordRowOrder(other.id.value, deletionOther.tabularContent.rows.reversed().map { it.value }),
        ))
        val deletion = scenario.app.deleteRecord(target.id.value, scenario.row.value, capture)
        val deletionAfter = store.loadWorkbookBundle()
        assertNotEquals(admissionBefore, deletionAfter)
        assertEquals(deletionOther.tabularContent.rows.reversed(), deletionAfter.findSheet(other.id)!!.tabularContent.rows)
        assertFalse(scenario.row in deletionAfter.findSheet(target.id)!!.tabularContent.rows)

        fun replay(direction: String) = scenario.app.replayDeletion(target.id.value, scenario.row.value, deletion.deletionId,
            RecordReplayRequest(UUID.randomUUID().toString(), direction, WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle())))
        val undone = replay("undo").workbook.toLifecycleWorkbook()
        assertTrue(sameWorkbookContent(deletionBefore, undone))
        assertFalse(sameWorkbookContent(admissionAfter, undone))
        assertEquals(formula, undone.findSheet(target.id)!!.tabularContent.cellContents.getValue(coordinate))
        assertEquals(deletionTarget.presentation, undone.findSheet(target.id)!!.presentation)
        assertEquals(deletionTarget.sorting, undone.findSheet(target.id)!!.sorting)
        val redone = replay("redo").workbook.toLifecycleWorkbook()
        assertTrue(sameWorkbookContent(deletionAfter, redone))
        assertFalse(sameWorkbookContent(admissionBefore, redone))
        assertEquals(redone, store.loadWorkbookBundle())
    }
}
