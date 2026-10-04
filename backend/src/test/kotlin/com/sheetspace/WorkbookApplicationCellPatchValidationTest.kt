package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookApplicationCellPatchValidationTest {
    @Test
    fun `application rejects an empty cell patch without mutation`() = fixture().assertRejected(
        WorkbookApplicationError.EMPTY_CELL_PATCH,
        CellPatchCommand(emptyList(), emptyList()),
    )

    @Test
    fun `application rejects a malformed write sheet ID without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(WorkbookApplicationError.INVALID_CELL_PATCH, fixture.command(fixture.write.copy(sheetId = "bad")))
    }

    @Test
    fun `application rejects a malformed write row ID without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(WorkbookApplicationError.INVALID_CELL_PATCH, fixture.command(fixture.write.copy(rowId = "bad")))
    }

    @Test
    fun `application rejects a malformed write column ID without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(WorkbookApplicationError.INVALID_CELL_PATCH, fixture.command(fixture.write.copy(columnId = "bad")))
    }

    @Test
    fun `application rejects a malformed expected sheet ID without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(
            WorkbookApplicationError.INVALID_CELL_PATCH,
            CellPatchCommand(listOf(ExpectedSheetRevision("bad", 0)), listOf(fixture.write)),
        )
    }

    @Test
    fun `application rejects a negative expected revision without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(
            WorkbookApplicationError.INVALID_CELL_PATCH,
            CellPatchCommand(listOf(ExpectedSheetRevision(fixture.first.id.value, -1)), listOf(fixture.write)),
        )
    }

    @Test
    fun `application rejects duplicate cell writes without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(WorkbookApplicationError.DUPLICATE_CELL_WRITE, fixture.command(fixture.write, fixture.write))
    }

    @Test
    fun `application rejects duplicate expected revisions without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(
            WorkbookApplicationError.DUPLICATE_SHEET_REVISION,
            CellPatchCommand(listOf(fixture.expected, fixture.expected), listOf(fixture.write)),
        )
    }

    @Test
    fun `application rejects an expected revision for another sheet without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(
            WorkbookApplicationError.INVALID_CELL_PATCH,
            CellPatchCommand(listOf(ExpectedSheetRevision(fixture.second.id.value, 0)), listOf(fixture.write)),
        )
    }

    @Test
    fun `application rejects an expected revision for a missing sheet when writes target another sheet`() = fixture().let { fixture ->
        fixture.assertRejected(
            WorkbookApplicationError.INVALID_CELL_PATCH,
            CellPatchCommand(
                listOf(fixture.expected, ExpectedSheetRevision("00000000-0000-0000-0000-000000000099", 0)),
                listOf(fixture.write),
            ),
        )
    }

    @Test
    fun `application rejects writes without expected revisions without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(WorkbookApplicationError.INVALID_CELL_PATCH, CellPatchCommand(emptyList(), listOf(fixture.write)))
    }

    @Test
    fun `application rejects a foreign row coordinate without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(
            WorkbookApplicationError.INVALID_CELL_COORDINATE,
            fixture.command(fixture.write.copy(rowId = RowId.generate().value)),
        )
    }

    @Test
    fun `application rejects a foreign column coordinate without mutation`() = fixture().let { fixture ->
        fixture.assertRejected(
            WorkbookApplicationError.INVALID_CELL_COORDINATE,
            fixture.command(fixture.write.copy(columnId = ColumnId.generate().value)),
        )
    }

    private fun fixture(): CellPatchFixture {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val first = application.createSheet(CreateSheetCommand("First"))
        val second = application.createSheet(CreateSheetCommand("Second"))
        return CellPatchFixture(application, first, second, first.cellWrite("A1", "one"))
    }

    private data class CellPatchFixture(
        val application: WorkbookApplication,
        val first: SheetDocument,
        val second: SheetDocument,
        val write: SheetCellWrite,
    ) {
        val expected = ExpectedSheetRevision(first.id.value, first.revision)

        fun command(vararg writes: SheetCellWrite) = CellPatchCommand(listOf(expected), writes.toList())

        fun assertRejected(expectedError: WorkbookApplicationError, command: CellPatchCommand) {
            val before = application.loadWorkbookBundle()
            val exception = assertFailsWith<WorkbookApplicationException> { application.writeCells(command) }
            assertEquals(expectedError, exception.error)
            assertEquals(before, application.loadWorkbookBundle())
        }
    }
}
