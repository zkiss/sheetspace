package com.sheetspace

import java.util.Collections
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkbookApplicationTest {
    @Test
    fun `sheet lifecycle mutates workbook through store port`() {
        val store = InMemoryWorkbookStore()
        val application = DefaultWorkbookApplication(store)
        val created = application.createSheet(
            CreateSheetCommand(
                name = " Inputs ",
                position = WorkspacePosition(12.0, 24.0),
                frameSize = SheetFrameSize(320.0, 220.0),
            ),
        )

        val updated = application.updateSheet(
            created.id,
            created.revision,
            UpdateSheetCommand(
                name = "Model",
                position = WorkspacePosition(30.0, 40.0),
                zIndex = 3,
            ),
        )
        val withRow = application.appendRow(updated.id, updated.revision)
        val withColumn = application.appendColumn(withRow.id, withRow.revision)
        application.deleteSheet(withColumn.id, withColumn.revision)

        assertEquals("Inputs", created.name)
        assertEquals("Model", updated.name)
        assertEquals(WorkspacePosition(30.0, 40.0), updated.position)
        assertEquals(3, updated.zIndex)
        assertEquals(DEFAULT_ROW_COUNT + 1, withRow.rowCount)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, withColumn.columnCount)
        assertEquals(emptyWorkbook(), store.loadWorkbook())
    }

    @Test
    fun `cell updates preserve raw content and empty content removes cell`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand(name = "Inputs"))

        val stored = application.updateCell(sheet.id, "A1", "= \n SuM ( B1 , B2 )", sheet.revision)
        val cleared = application.updateCell(stored.id, "A1", "", stored.revision)

        assertEquals("= \n SuM ( B1 , B2 )", stored.cells.getValue("A1"))
        assertFalse(cleared.cells.containsKey("A1"))
    }

    @Test
    fun `application rejects invalid domain commands without changing store`() {
        val store = InMemoryWorkbookStore()
        val application = DefaultWorkbookApplication(store)
        val sheet = application.createSheet(CreateSheetCommand(name = "Inputs"))

        assertApplicationError(WorkbookApplicationError.SHEET_NAME_REQUIRED) {
            application.createSheet(CreateSheetCommand(name = "   "))
        }
        assertApplicationError(WorkbookApplicationError.SHEET_NAME_DUPLICATE) {
            application.createSheet(CreateSheetCommand(name = "Inputs"))
        }
        assertApplicationError(WorkbookApplicationError.INVALID_SHEET_POSITION) {
            application.createSheet(
                CreateSheetCommand(name = "Other", position = WorkspacePosition(Double.NaN, 0.0)),
            )
        }
        assertApplicationError(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE) {
            application.updateSheet(
                sheet.id,
                sheet.revision,
                UpdateSheetCommand(frameSize = SheetFrameSize(0.0, 1.0)),
            )
        }
        assertApplicationError(WorkbookApplicationError.INVALID_SHEET_Z_INDEX) {
            application.updateSheet(sheet.id, sheet.revision, UpdateSheetCommand(zIndex = 0))
        }
        assertApplicationError(WorkbookApplicationError.SHEET_UPDATE_REQUIRED) {
            application.updateSheet(sheet.id, sheet.revision, UpdateSheetCommand())
        }
        assertApplicationError(WorkbookApplicationError.INVALID_CELL_ADDRESS) {
            application.updateCell(sheet.id, "Z999", "outside", sheet.revision)
        }

        assertEquals(listOf(sheet), store.loadWorkbook().sheets)
    }

    @Test
    fun `invalid rename wins over stale revision conflict`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val created = application.createSheet(CreateSheetCommand(name = "Inputs"))
        application.updateCell(created.id, "A1", "newer", created.revision)

        assertApplicationError(WorkbookApplicationError.SHEET_NAME_REQUIRED) {
            application.updateSheet(
                created.id,
                created.revision,
                UpdateSheetCommand(name = "   "),
            )
        }
    }

    @Test
    fun `stale revision is rejected without overwriting current state`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val created = application.createSheet(CreateSheetCommand(name = "Inputs"))
        val newer = application.updateCell(created.id, "A1", "newer", created.revision)

        val conflict = assertFailsWith<SheetRevisionConflict> {
            application.updateCell(created.id, "A1", "stale", created.revision)
        }

        assertEquals(newer.revision, conflict.actualRevision)
        assertEquals("newer", application.loadSheet(created.id).cells.getValue("A1"))
    }

    @Test
    fun `concurrent creations assign distinct default z indexes atomically`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val gate = CountDownLatch(1)
        val created = Collections.synchronizedList(mutableListOf<Sheet>())
        val workers = listOf("Inputs", "Outputs").map { name ->
            thread {
                gate.await()
                created += application.createSheet(CreateSheetCommand(name = name))
            }
        }

        gate.countDown()
        workers.forEach { it.join() }

        assertEquals(setOf(1, 2), created.map { it.zIndex }.toSet())
        assertEquals(setOf("Inputs", "Outputs"), application.loadWorkbook().sheets.map { it.name }.toSet())
    }

    @Test
    fun `unknown sheet operations return application error`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())

        assertApplicationError(WorkbookApplicationError.SHEET_NOT_FOUND) {
            application.loadSheet("missing")
        }
        assertApplicationError(WorkbookApplicationError.SHEET_NOT_FOUND) {
            application.updateSheet("missing", 0, UpdateSheetCommand())
        }
        assertApplicationError(WorkbookApplicationError.SHEET_NOT_FOUND) {
            application.updateSheet(
                "missing",
                0,
                UpdateSheetCommand(position = WorkspacePosition(Double.NaN, 0.0)),
            )
        }
        assertApplicationError(WorkbookApplicationError.SHEET_NOT_FOUND) {
            application.appendRow("missing", 0)
        }
    }

    private fun assertApplicationError(
        expected: WorkbookApplicationError,
        block: () -> Unit,
    ) {
        val rejection = assertFailsWith<WorkbookApplicationException>(block = block)
        assertEquals(expected, rejection.error)
    }
}
