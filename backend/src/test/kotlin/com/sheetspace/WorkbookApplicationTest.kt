package com.sheetspace

import java.util.Collections
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertSame

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
            created.id.value,
            created.revision,
            UpdateSheetCommand(
                name = "Model",
                position = WorkspacePosition(30.0, 40.0),
            ),
        )
        val reordered = application.updateSheetZOrder(
            listOf(SheetZOrderUpdate(updated.id.value, updated.revision, 3)),
        ).single()
        val withRow = application.appendRow(reordered.id.value, reordered.revision)
        val withColumn = application.appendColumn(withRow.sheet.id.value, withRow.sheet.revision)
        application.deleteSheet(withColumn.sheet.id.value, withColumn.sheet.revision)

        assertEquals("Inputs", created.name)
        assertEquals("Model", updated.name)
        assertEquals(WorkspacePosition(30.0, 40.0), updated.frame.position)
        assertEquals(3, reordered.frame.zIndex)
        assertEquals(DEFAULT_ROW_COUNT + 1, withRow.sheet.tabularContent.rowCount)
        assertEquals(withRow.rowId, withRow.sheet.tabularContent.rows.last())
        assertEquals(DEFAULT_COLUMN_COUNT + 1, withColumn.sheet.tabularContent.columnCount)
        assertEquals(withColumn.columnId, withColumn.sheet.tabularContent.columns.last())
        assertEquals(emptyList(), store.loadWorkbookBundle().manifest.sheetIds)
    }

    @Test
    fun `frame and tabular application paths preserve unrelated submodels`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val created = application.createSheet(CreateSheetCommand(name = "Inputs"))

        val moved = application.updateSheet(
            created.id.value,
            created.revision,
            UpdateSheetCommand(position = WorkspacePosition(10.0, 20.0)),
        )
        val edited = application.writeOneCell(moved.id.value, "A1", "42", moved.revision)

        assertSame(created.content, moved.content)
        assertSame(moved.frame, edited.frame)
    }

    @Test
    fun `scale-only updates are revisioned and preserve the rest of frame layout`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val created = application.createSheet(
            CreateSheetCommand(name = "Inputs", position = WorkspacePosition(10.0, 20.0), frameSize = SheetFrameSize(320.0, 220.0), visualScale = 0.5),
        )

        val updated = application.updateSheet(created.id.value, created.revision, UpdateSheetCommand(visualScale = 2.0))

        assertEquals(WorkspacePosition(10.0, 20.0), updated.frame.position)
        assertEquals(SheetFrameSize(320.0, 220.0), updated.frame.size)
        assertEquals(2.0, updated.frame.visualScale)
        assertEquals(created.frame.zIndex, updated.frame.zIndex)
        val beforeInvalidScale = application.loadWorkbookBundle()
        assertApplicationError(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE) {
            application.updateSheet(
                updated.id.value,
                updated.revision,
                UpdateSheetCommand(position = WorkspacePosition(99.0, 99.0), visualScale = 0.0),
            )
        }
        assertEquals(beforeInvalidScale, application.loadWorkbookBundle())

        val beforeStaleFrame = application.loadWorkbookBundle()
        val conflict = assertFailsWith<SheetRevisionConflict> {
            application.updateSheet(
                updated.id.value,
                created.revision,
                UpdateSheetCommand(position = WorkspacePosition(99.0, 99.0), frameSize = SheetFrameSize(1.0, 1.0), visualScale = 1.0),
            )
        }
        assertEquals(updated.id.value, conflict.sheetId)
        assertEquals(created.revision, conflict.expectedRevision)
        assertEquals(updated.revision, conflict.actualRevision)
        assertEquals(beforeStaleFrame, application.loadWorkbookBundle())
    }

    @Test
    fun `cell updates preserve raw content and empty content removes cell`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand(name = "Inputs"))

        val stored = application.writeOneCell(sheet.id.value, "A1", "= \n SuM ( B1 , B2 )", sheet.revision)
        val cleared = application.writeOneCell(stored.id.value, "A1", "", stored.revision)

        assertEquals("= \n SuM ( B1 , B2 )", stored.tabularContent.cells.getValue("A1"))
        assertFalse(cleared.tabularContent.cells.containsKey("A1"))
    }

    @Test
    fun `cell update uses targeted store reads and batch write`() {
        val sheet = createSheetDocument("Inputs").let {
            (it as SheetNameResult.Valid).value
        }
        val targetedStore = TargetedCellStore(
            InMemoryWorkbookStore(
                WorkbookState(
                    manifest = WorkbookManifest(sheetIds = listOf(sheet.id)),
                    documents = mapOf(sheet.id to sheet),
                ),
            ),
        )
        val application = DefaultWorkbookApplication(targetedStore)

        val updated = application.writeOneCell(sheet.id.value, "A1", "42", 0)

        assertEquals("42", updated.tabularContent.cells.getValue("A1"))
        assertEquals(3, targetedStore.targetedLoads)
        assertEquals(1, targetedStore.batchWrites)
        assertEquals(0, targetedStore.workbookLoads)
    }

    @Test
    fun `cell batch validates every sheet before changing any sheet`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val inputs = application.createSheet(CreateSheetCommand(name = "Inputs"))
        val outputs = application.createSheet(CreateSheetCommand(name = "Outputs"))
        val valid = inputs.cellWrite("A1", "source")
        val invalid = outputs.cellWrite("A1", "result").copy(rowId = "00000000-0000-0000-0000-000000000099")
        val before = application.loadWorkbookBundle()

        assertApplicationError(WorkbookApplicationError.INVALID_CELL_COORDINATE) {
            application.writeCells(
                CellPatchCommand(
                    listOf(
                        ExpectedSheetRevision(inputs.id.value, inputs.revision),
                        ExpectedSheetRevision(outputs.id.value, outputs.revision),
                    ),
                    listOf(valid, invalid),
                ),
            )
        }

        assertEquals(before, application.loadWorkbookBundle())
    }

    @Test
    fun `invalid rename wins over stale revision conflict`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val created = application.createSheet(CreateSheetCommand(name = "Inputs"))
        application.writeOneCell(created.id.value, "A1", "newer", created.revision)
        val before = application.loadWorkbookBundle()

        assertApplicationError(WorkbookApplicationError.SHEET_NAME_REQUIRED) {
            application.updateSheet(
                created.id.value,
                created.revision,
                UpdateSheetCommand(name = "   "),
            )
        }
        assertEquals(before, application.loadWorkbookBundle())
    }

    @Test
    fun `stale revision is rejected without overwriting current state`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val created = application.createSheet(CreateSheetCommand(name = "Inputs"))
        val newer = application.writeOneCell(created.id.value, "A1", "newer", created.revision)
        val before = application.loadWorkbookBundle()

        val conflict = assertFailsWith<SheetRevisionConflict> {
            application.writeOneCell(created.id.value, "A1", "stale", created.revision)
        }

        assertEquals(created.id.value, conflict.sheetId)
        assertEquals(created.revision, conflict.expectedRevision)
        assertEquals(newer.revision, conflict.actualRevision)
        assertEquals(before, application.loadWorkbookBundle())
    }

    @Test
    fun `concurrent creations assign distinct default z indexes atomically`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val gate = CountDownLatch(1)
        val created = Collections.synchronizedList(mutableListOf<SheetDocument>())
        val workers = listOf("Inputs", "Outputs").map { name ->
            thread {
                gate.await()
                created += application.createSheet(CreateSheetCommand(name = name))
            }
        }

        gate.countDown()
        workers.forEach { it.join() }

        assertEquals(setOf(1, 2), created.map { it.frame.zIndex }.toSet())
        assertEquals(
            setOf("Inputs", "Outputs"),
            application.loadWorkbookBundle().documents.values.map { it.name }.toSet(),
        )
    }

    @Test
    fun `loading a missing sheet returns application error`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val before = application.loadWorkbookBundle()
        assertApplicationError(WorkbookApplicationError.SHEET_NOT_FOUND) {
            application.loadSheet("missing")
        }
        assertEquals(before, application.loadWorkbookBundle())
    }

    @Test
    fun `appending a row to a missing sheet returns application error`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val before = application.loadWorkbookBundle()
        assertApplicationError(WorkbookApplicationError.SHEET_NOT_FOUND) {
            application.appendRow("missing", 0)
        }
        assertEquals(before, application.loadWorkbookBundle())
    }

    @Test
    fun `missing sheet wins before an empty update validation`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val before = application.loadWorkbookBundle()
        assertApplicationError(WorkbookApplicationError.SHEET_NOT_FOUND) {
            application.updateSheet("missing", 0, UpdateSheetCommand())
        }
        assertEquals(before, application.loadWorkbookBundle())
    }

    @Test
    fun `missing sheet wins before an invalid frame validation`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val before = application.loadWorkbookBundle()
        assertApplicationError(WorkbookApplicationError.SHEET_NOT_FOUND) {
            application.updateSheet(
                "missing",
                0,
                UpdateSheetCommand(position = WorkspacePosition(Double.NaN, 0.0)),
            )
        }
        assertEquals(before, application.loadWorkbookBundle())
    }

    private fun assertApplicationError(
        expected: WorkbookApplicationError,
        block: () -> Unit,
    ) {
        val rejection = assertFailsWith<WorkbookApplicationException>(block = block)
        assertEquals(expected, rejection.error)
    }
}

private class TargetedCellStore(
    private val delegate: WorkbookStore,
) : WorkbookStore by delegate {
    var targetedLoads: Int = 0
    var batchWrites: Int = 0
    var workbookLoads: Int = 0

    override fun loadSheet(sheetId: SheetId): SheetDocument? {
        targetedLoads++
        return delegate.loadSheet(sheetId)
    }

    override fun loadWorkbookBundle(): WorkbookState {
        workbookLoads++
        return delegate.loadWorkbookBundle()
    }

    override fun writeCells(
        expectedRevisions: List<ExpectedSheetRevision>,
        writes: List<SheetCellWrite>,
    ): List<SheetDocument> {
        batchWrites++
        return delegate.writeCells(expectedRevisions, writes)
    }
}
