package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class AtomicRecordAdmissionTest {
    @Test
    fun `admission persists non-tail record and cross-sheet order once while retaining identities and recipes`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val result = scenario.admit()
        val target = result.workbook.documents.getValue(scenario.target.id)
        val other = result.workbook.documents.getValue(scenario.other.id)
        assertFalse(result.alreadyCommitted)
        assertEquals(scenario.row, result.rowId)
        assertEquals(listOf(scenario.row) + scenario.target.tabularContent.rows, target.tabularContent.rows)
        assertEquals(scenario.other.tabularContent.rows.reversed(), other.tabularContent.rows)
        assertEquals(scenario.before.manifest, result.workbook.manifest)
        assertEquals(scenario.target.revision + 1, target.revision)
        assertEquals(scenario.other.revision + 1, other.revision)
        assertEquals(scenario.untouched, result.workbook.documents.getValue(scenario.untouched.id))
        assertEquals(scenario.other.tabularContent.cellContents, other.tabularContent.cellContents)
        assertEquals(scenario.target, target.copy(revision = scenario.target.revision, content = scenario.target.content))
        assertEquals(scenario.target.tabularContent.cellContents, target.tabularContent.cellContents.filterKeys { it.rowId != scenario.row })
        val output = target.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val instance = target.tabularContent.cellContents.getValue(CellCoordinate(scenario.row, output))
        val template = target.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT)
        assertEquals(derivedFormulaRaw(template, scenario.before, 2, "=@A[2]*2", target.id.value), instance)
        assertNotEquals(derivedFormulaRaw(template, result.workbook, 0, "=@A[2]*2", target.id.value), instance)
        assertEquals(result.workbook, store.loadWorkbookBundle())
        assertEquals(1, admissionReceipts(store))
    }

    @Test
    fun `ordinary admission without orders appends tail and leaves other revisions unchanged`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val result = scenario.admit(scenario.request.copy(rowOrders = emptyList()))
        assertEquals(scenario.target.tabularContent.rows + scenario.row, result.workbook.documents.getValue(scenario.target.id).tabularContent.rows)
        assertEquals(scenario.other, result.workbook.documents.getValue(scenario.other.id))
        assertEquals(scenario.untouched, result.workbook.documents.getValue(scenario.untouched.id))
        assertTrue(result.workbook.documents.getValue(scenario.target.id).sorting.isNotEmpty())
    }
}
