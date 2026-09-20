package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class WorkbookApplicationValidationCoverageTest {
    @Test
    fun `application maps every command validation boundary to its public error`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand(name = "Inputs"))
        application.createSheet(CreateSheetCommand(name = "Outputs"))
        val validWrite = sheet.cellWrite("A1", "value")

        assertError(WorkbookApplicationError.SHEET_NAME_REQUIRED) { application.createSheet(CreateSheetCommand(" ")) }
        assertError(WorkbookApplicationError.SHEET_UPDATE_REQUIRED) {
            application.updateSheet(sheet.id.value, sheet.revision, UpdateSheetCommand())
        }
        assertError(WorkbookApplicationError.SHEET_NAME_DUPLICATE) {
            application.updateSheet(sheet.id.value, sheet.revision, UpdateSheetCommand(name = "Outputs"))
        }
        assertError(WorkbookApplicationError.SHEET_Z_ORDER_UPDATE_REQUIRED) { application.updateSheetZOrder(emptyList()) }
        assertError(WorkbookApplicationError.DUPLICATE_SHEET_Z_ORDER_UPDATE) {
            application.updateSheetZOrder(listOf(SheetZOrderUpdate(sheet.id.value, 0, 2), SheetZOrderUpdate(sheet.id.value, 0, 3)))
        }
        assertError(WorkbookApplicationError.SHEET_NOT_FOUND) {
            application.updateSheetZOrder(listOf(SheetZOrderUpdate(TEST_SHEET_2, 0, 2)))
        }
        assertError(WorkbookApplicationError.EMPTY_CELL_PATCH) { application.writeCells(CellPatchCommand(emptyList(), emptyList())) }
        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision("bad", 0)), listOf(validWrite)))
        }
        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(sheet.id.value, -1)), listOf(validWrite)))
        }
        assertError(WorkbookApplicationError.DUPLICATE_CELL_WRITE) {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(sheet.id.value, 0)), listOf(validWrite, validWrite)))
        }
        assertError(WorkbookApplicationError.DUPLICATE_SHEET_REVISION) {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(sheet.id.value, 0), ExpectedSheetRevision(sheet.id.value, 1)), listOf(validWrite)))
        }
        assertError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            application.writeCells(CellPatchCommand(emptyList(), listOf(validWrite)))
        }
        assertError(WorkbookApplicationError.INVALID_CELL_COORDINATE) {
            application.writeCells(
                CellPatchCommand(
                    listOf(ExpectedSheetRevision(sheet.id.value, 0)),
                    listOf(validWrite.copy(rowId = RowId.generate().value)),
                ),
            )
        }
        assertError(WorkbookApplicationError.INVALID_SHEET_Z_INDEX) {
            application.createSheet(CreateSheetCommand("Other", zIndex = 0))
        }
        assertError(WorkbookApplicationError.INVALID_SHEET_POSITION) {
            application.updateSheet(sheet.id.value, 0, UpdateSheetCommand(position = WorkspacePosition(Double.NaN, 1.0)))
        }
        assertError(WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE) {
            application.updateSheet(sheet.id.value, 0, UpdateSheetCommand(frameSize = SheetFrameSize(Double.POSITIVE_INFINITY, 1.0)))
        }
        assertError(WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE) {
            application.updateSheet(sheet.id.value, 0, UpdateSheetCommand(visualScale = Double.NaN))
        }
    }

    private fun assertError(expected: WorkbookApplicationError, block: () -> Unit) {
        assertEquals(expected, assertFailsWith<WorkbookApplicationException>(block = block).error)
    }
}

class SqlitePersistenceBoundaryCoverageTest {
    @Test
    fun `tabular address parsing and resize cover invalid and boundary forms`() {
        val content = TabularContent(columnCount = 1, rowCount = 1)

        assertNull(content.coordinateAt("A0"))
        assertNull(content.coordinateAt("A999999999999999999999"))
        assertNull(content.coordinateAt("ZZZZZZZZZZ1"))
        assertNull(content.addressOf(CellCoordinate(RowId.generate(), content.columns.first())))
        assertNull(content.addressOf(CellCoordinate(content.rows.first(), ColumnId.generate())))
        assertFailsWith<IllegalArgumentException> { content.copy(columnCount = -1) }
        assertFailsWith<IllegalArgumentException> { content.copy(rowCount = -1) }
        assertEquals(false, content.equals("not tabular"))
    }

    @Test
    fun `cell writer rejects malformed batches and preserves no op revisions`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))

        assertFailsWith<IllegalArgumentException> {
            store.writeCells(emptyList(), listOf(sheet.cellWrite("A1", "value")))
        }
        assertFailsWith<IllegalArgumentException> {
            store.writeCells(
                listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
                listOf(sheet.cellWrite("A1", "one"), sheet.cellWrite("A1", "two")),
            )
        }

        val unchanged = store.writeCells(
            listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
            listOf(sheet.cellWrite("A1", "")),
        ).single()

        assertEquals(0, unchanged.revision)
        assertEquals(emptyMap(), unchanged.tabularContent.cells)
    }

    @Test
    fun `transaction writer reports mismatched missing and out of bounds cell targets`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))

        withWriter(store) { writer, _ ->
            assertFailsWith<IllegalArgumentException> {
                writer.writeCells(emptyList(), listOf(sheet.cellWrite("A1", "value")))
            }
            assertFailsWith<NoSuchElementException> {
                writer.writeCells(
                    listOf(ExpectedSheetRevision(TEST_SHEET_2, 0)),
                    listOf(SheetCellWrite(TEST_SHEET_2, sheet.tabularContent.rows.first().value, sheet.tabularContent.columns.first().value, "value")),
                )
            }
            assertFailsWith<IllegalArgumentException> {
                writer.writeCells(
                    listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
                    listOf(SheetCellWrite(TEST_SHEET_1, RowId.generate().value, sheet.tabularContent.columns.first().value, "value")),
                )
            }
        }
    }

    @Test
    fun `writer presentation failures cover missing stale and invalid writes`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val row = sheet.tabularContent.rows.first().value

        withWriter(store) { writer, _ ->
            assertFailsWith<NoSuchElementException> {
                writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_2, 0), listOf(AxisSizeWrite("row", row, 30.0)))
            }
            assertFailsWith<SheetRevisionConflict> {
                writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 1), listOf(AxisSizeWrite("row", row, 30.0)))
            }
            assertFailsWith<WorkbookApplicationException> {
                writer.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList())
            }
        }
    }

    @Test
    fun `reader exposes stored version and writer detects an obsolete aggregate snapshot`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val stale = store.loadWorkbookBundle()
        store.writeCells(
            listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
            listOf(sheet.cellWrite("A1", "newer")),
        )

        withWriter(store) { writer, reader ->
            assertEquals(WORKBOOK_SCHEMA_VERSION, reader.loadStoredSchemaVersion())
            assertEquals(1, reader.loadSheetRevision(sheet.id))
            assertNull(reader.loadSheetRevision(SheetId(TEST_SHEET_2)))
            val changed = stale.findSheet(sheet.id)!!.rename("Renamed")
            assertFailsWith<SheetRevisionConflict> {
                writer.persistChanges(stale, stale.replaceSheet(changed))
            }
        }
    }

    @Test
    fun `aggregate persistence applies additions removals and changed aggregate fields`() = withSqliteStore { store ->
        val first = testDocument(TEST_SHEET_1, "Inputs")
        val second = testDocument(TEST_SHEET_2, "Outputs")
        store.saveWorkbook(testWorkbookOf(first))

        val changed = first
            .rename("Renamed")
            .updateFrame { it.update(position = WorkspacePosition(7.0, 8.0)) }
            .updateTabularContent { it.copy(rowCount = DEFAULT_ROW_COUNT - 1, columnCount = DEFAULT_COLUMN_COUNT + 1) }
        store.updateWorkbook { current ->
            current.replaceSheet(changed).addSheet(second)
        }
        store.updateWorkbook { current -> current.removeSheet(second.id) }

        val loaded = store.loadSheet(first.id)!!
        assertEquals("Renamed", loaded.name)
        assertEquals(WorkspacePosition(7.0, 8.0), loaded.frame.position)
        assertEquals(DEFAULT_ROW_COUNT - 1, loaded.tabularContent.rowCount)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, loaded.tabularContent.columnCount)
        assertNull(store.loadSheet(second.id))
    }

    @Test
    fun `store validates z order writes before starting a transaction`() = withSqliteStore { store ->
        val first = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(first))

        assertFailsWith<IllegalArgumentException> { store.updateSheetZOrder(emptyList()) }
        assertFailsWith<IllegalArgumentException> {
            store.updateSheetZOrder(
                listOf(
                    SheetZOrderWrite(ExpectedSheetRevision(TEST_SHEET_1, 0), 2),
                    SheetZOrderWrite(ExpectedSheetRevision(TEST_SHEET_1, 0), 3),
                ),
            )
        }
    }

    private fun withWriter(
        store: SqliteWorkbookStore,
        block: (SqliteWorkbookWriter, SqliteWorkbookReader) -> Unit,
    ) {
        SqliteDatabase(store.jdbcUrl, null).use { database ->
            database.transaction { connection ->
                val reader = SqliteWorkbookReader(connection)
                block(SqliteWorkbookWriter(connection, reader), reader)
            }
        }
    }
}
