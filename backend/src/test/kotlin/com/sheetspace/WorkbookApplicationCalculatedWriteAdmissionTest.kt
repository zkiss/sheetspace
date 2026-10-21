package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * Ordinary content writes are admitted by the application, so a calculated target is rejected
 * before the store is asked to write, whatever the store would have done with the write.
 */
class WorkbookApplicationCalculatedWriteAdmissionTest {
    @Test
    fun `a calculated target is rejected before the store is reached`() {
        val fixture = AdmissionFixture()
        val calculated = fixture.sheet.tabularContent.coordinateAt("B1")!!

        val rejection = assertFailsWith<WorkbookApplicationException> {
            fixture.application.writeCells(
                fixture.command(
                    fixture.sheet,
                    SheetCellWrite(fixture.sheet.id.value, calculated.rowId.value, calculated.columnId.value, "=override"),
                ),
            )
        }

        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejection.error)
        assertEquals(0, fixture.store.cellWrites)
        assertEquals(fixture.workbook, fixture.application.loadWorkbookBundle())
    }

    @Test
    fun `a manual property of a bound sheet stays writable`() {
        val fixture = AdmissionFixture()
        val manual = fixture.sheet.tabularContent.coordinateAt("A1")!!

        val updated = fixture.application.writeCells(
            fixture.command(
                fixture.sheet,
                SheetCellWrite(fixture.sheet.id.value, manual.rowId.value, manual.columnId.value, "42"),
            ),
        )

        assertEquals("42", updated.single().tabularContent.cells.getValue("A1"))
        assertEquals(1, fixture.store.cellWrites)
    }

    @Test
    fun `a manual write paired with a calculated target is rejected as a whole`() {
        val fixture = AdmissionFixture()
        val manual = fixture.sheet.tabularContent.coordinateAt("A1")!!
        val calculated = fixture.otherSheet.tabularContent.coordinateAt("B1")!!

        val rejection = assertFailsWith<WorkbookApplicationException> {
            fixture.application.writeCells(
                CellPatchCommand(
                    listOf(
                        ExpectedSheetRevision(fixture.sheet.id.value, fixture.sheet.revision),
                        ExpectedSheetRevision(fixture.otherSheet.id.value, fixture.otherSheet.revision),
                    ),
                    listOf(
                        SheetCellWrite(fixture.sheet.id.value, manual.rowId.value, manual.columnId.value, "manual"),
                        SheetCellWrite(fixture.otherSheet.id.value, calculated.rowId.value, calculated.columnId.value, "=override"),
                    ),
                ),
            )
        }

        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejection.error)
        assertEquals(0, fixture.store.cellWrites)
        assertEquals(fixture.workbook, fixture.application.loadWorkbookBundle())
    }

    private class AdmissionFixture {
        val workbook = lifecycleBoundWorkbook(lifecycleWorkbook())
        val store = RecordingCellStore(InMemoryWorkbookStore(workbook))
        val application = DefaultWorkbookApplication(store)
        val sheet = workbook.sheetsInOrder.first()
        val otherSheet = workbook.sheetsInOrder.last()

        fun command(sheet: SheetDocument, write: SheetCellWrite) = CellPatchCommand(
            listOf(ExpectedSheetRevision(sheet.id.value, sheet.revision)),
            listOf(write),
        )
    }
}

private class RecordingCellStore(
    private val delegate: WorkbookStore,
) : WorkbookStore by delegate {
    var cellWrites: Int = 0

    override fun writeCells(
        expectedRevisions: List<ExpectedSheetRevision>,
        writes: List<SheetCellWrite>,
    ): List<SheetDocument> {
        cellWrites++
        return delegate.writeCells(expectedRevisions, writes)
    }
}
