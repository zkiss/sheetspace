package com.sheetspace

import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Covers persistence failure modes and value contracts that route-level scenarios cannot observe. */
class RemainingCoverageBehaviorTest {
    @Test
    fun `store rejects unsupported and duplicate persistence inputs`() = withSqliteStore { store ->
        val first = testDocument(TEST_SHEET_1, "Inputs")
        val second = testDocument(TEST_SHEET_2, "Outputs")
        assertFailsWith<IllegalArgumentException> {
            store.saveWorkbook(testWorkbookOf(first).copy(manifest = WorkbookManifest(version = WORKBOOK_SCHEMA_VERSION + 1, sheetIds = listOf(first.id))))
        }
        store.saveWorkbook(testWorkbookOf(first, second))
        assertFailsWith<IllegalArgumentException> {
            store.writeCells(
                listOf(ExpectedSheetRevision(first.id.value, 0), ExpectedSheetRevision(first.id.value, 0)),
                listOf(first.cellWrite("A1", "one")),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            store.writeCells(listOf(ExpectedSheetRevision(first.id.value, 0)), emptyList())
        }
        assertFailsWith<NoSuchElementException> {
            store.updateSheetZOrder(listOf(SheetZOrderWrite(ExpectedSheetRevision("00000000-0000-0000-0000-000000000099", 0), 1)))
        }
        assertFailsWith<SheetRevisionConflict> {
            store.updateSheetZOrder(listOf(SheetZOrderWrite(ExpectedSheetRevision(first.id.value, 1), 1)))
        }
    }

    @Test
    fun `sqlite cell writer applies deletions and upserts in one batch`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val first = sheet.cellWrite("A1", "before")
        val second = sheet.cellWrite("B1", "remove")
        store.writeCells(listOf(ExpectedSheetRevision(sheet.id.value, 0)), listOf(first, second))
        val updated = store.writeCells(
            listOf(ExpectedSheetRevision(sheet.id.value, 1)),
            listOf(first.copy(raw = "after"), second.copy(raw = "")),
        ).single()
        assertEquals(mapOf("A1" to "after"), updated.tabularContent.cells)
        assertEquals(
            updated,
            store.writeCells(
                listOf(ExpectedSheetRevision(sheet.id.value, updated.revision)),
                listOf(first.copy(raw = "after")),
            ).single(),
        )
    }

    @Test
    fun `domain boundaries preserve workbook and presentation invariants`() {
        val first = testDocument(TEST_SHEET_1, "Inputs")
        assertEquals(1, (createSheetDocument("First") as SheetNameResult.Valid).value.frame.zIndex)
        assertEquals(9, (createSheetDocument("Second", listOf(first.copy(frame = FrameState(zIndex = 8))), zIndex = 9) as SheetNameResult.Valid).value.frame.zIndex)
        assertEquals(9, (createSheetDocument("Third", listOf(first.copy(frame = FrameState(zIndex = 8)), first.copy(id = SheetId.generate(), frame = FrameState(zIndex = 3)))) as SheetNameResult.Valid).value.frame.zIndex)
        assertEquals(9, (createSheetDocument("Fourth", listOf(first.copy(frame = FrameState(zIndex = 8)), first.copy(id = SheetId.generate(), frame = FrameState(zIndex = 8)))) as SheetNameResult.Valid).value.frame.zIndex)
        assertFailsWith<IllegalArgumentException> { WorkbookManifest(sheetIds = listOf(first.id, first.id)) }
        assertFailsWith<IllegalArgumentException> { WorkbookState(documents = mapOf(first.id to first)) }
        assertFailsWith<IllegalArgumentException> { WorkbookManifest().remove(first.id) }
        assertFailsWith<IllegalArgumentException> { testWorkbookOf(first).replaceSheet(testDocument(TEST_SHEET_2, "Other")) }
        assertFailsWith<IllegalArgumentException> { byteArrayOf(1).toUuidString() }

        val row = first.tabularContent.rows.first().value
        val column = first.tabularContent.columns.first().value
        assertTrue(AxisSizePolicy.validSize("row", AxisSizePolicy.MIN_ROW_HEIGHT))
        assertTrue(AxisSizePolicy.validSize("column", AxisSizePolicy.MAX_COLUMN_WIDTH))
        assertEquals(false, AxisSizePolicy.validSize("row", Double.NaN))
        assertEquals(false, AxisSizePolicy.validSize("row", AxisSizePolicy.MIN_ROW_HEIGHT - 1.0))
        assertEquals(false, AxisSizePolicy.validSize("column", AxisSizePolicy.MIN_COLUMN_WIDTH - 1.0))
        assertEquals(false, AxisSizePolicy.validSize("column", Double.POSITIVE_INFINITY))
        assertEquals(false, AxisSizePolicy.validSize("column", Double.NaN))
        assertEquals(false, AxisSizePolicy.validSize("other", 30.0))
        assertFailsWith<WorkbookApplicationException> { validatedPresentationWrites(first, listOf(AxisSizeWrite("row", row, 1.0))) }
        assertFailsWith<WorkbookApplicationException> { validatedPresentationWrites(first, listOf(AxisSizeWrite("column", column, null), AxisSizeWrite("column", column, null))) }
    }

    @Test
    fun `frame validation distinguishes each finite and size boundary`() {
        assertTrue(WorkspacePosition(1.0, 2.0).isValid())
        assertEquals(false, WorkspacePosition(Double.NaN, 2.0).isValid())
        assertEquals(false, WorkspacePosition(1.0, Double.NEGATIVE_INFINITY).isValid())
        assertTrue(SheetFrameSize(1.0, 2.0).isValid())
        assertEquals(false, SheetFrameSize(Double.NaN, 2.0).isValid())
        assertEquals(false, SheetFrameSize(1.0, Double.POSITIVE_INFINITY).isValid())
        assertEquals(false, SheetFrameSize(0.0, 2.0).isValid())
        assertEquals(false, SheetFrameSize(1.0, 0.0).isValid())
    }

    @Test
    fun `http decodes malformed requests and maps invalid positions`() = testWorkbookApplication { _ ->
        val malformed = client.post("/api/sheets") { jsonBody("{") }
        assertEquals(HttpStatusCode.BadRequest, malformed.status)
        assertEquals(ErrorResponse("invalid-request"), malformed.decodeBody<ErrorResponse>())
        val invalid = client.post("/api/sheets") { jsonBody("""{"name":"Inputs","position":{"x":"bad","y":0}}""") }
        assertEquals(HttpStatusCode.BadRequest, invalid.status)
        assertEquals(ErrorResponse("invalid-request"), invalid.decodeBody<ErrorResponse>())
        val infinite = client.post("/api/sheets") { jsonBody("""{"name":"Inputs","position":{"x":1e999,"y":0}}""") }
        assertEquals(HttpStatusCode.BadRequest, infinite.status)
        assertEquals(ErrorResponse("invalid-sheet-position"), infinite.decodeBody<ErrorResponse>())
    }

    @Test
    fun `transport value objects expose their complete data contracts`() {
        val revision = SheetRevisionResponse("sheet", 3)
        assertEquals("sheet", revision.component1())
        assertEquals(3, revision.component2())
        assertEquals(revision, revision.copy(revision = 3))
        val presentation = PresentationWriteRequest(listOf(AxisSizeWrite("row", "r", 20.0)))
        assertEquals(presentation, presentation.copy())
        assertEquals(presentation.writes, presentation.component1())
        val update = UpdateSheetZOrderRequest(listOf(SheetZOrderUpdateRequest("sheet", 1, 2)))
        assertEquals(update, update.copy())
        assertEquals(update.updates, update.component1())
        val response = UpdateSheetZOrderResponse(listOf(revision))
        assertEquals(response, response.copy())
        assertEquals(response.sheets, response.component1())
        assertEquals(CellPatchResponse(listOf(revision)), CellPatchResponse(listOf(revision)).copy())
        assertEquals(CellRevisionRequest("sheet", 1), CellRevisionRequest("sheet", 1).copy())
        assertEquals(CellWriteRequest("sheet", "row", "column", "raw"), CellWriteRequest("sheet", "row", "column", "raw").copy())
    }

    @Test
    fun `application validates each UUID component and frame command branch`() {
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val sheet = application.createSheet(CreateSheetCommand("Inputs", zIndex = 2))
        val valid = sheet.cellWrite("A1", "value")
        fun invalid(write: SheetCellWrite) = assertFailsWith<WorkbookApplicationException> {
            application.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(sheet.id.value, 0)), listOf(write)))
        }
        invalid(valid.copy(sheetId = "bad"))
        invalid(valid.copy(rowId = "bad"))
        invalid(valid.copy(columnId = "bad"))
        assertFailsWith<WorkbookApplicationException> {
            application.createSheet(CreateSheetCommand("Bad", frameSize = SheetFrameSize(0.0, 1.0)))
        }
    }

    @Test
    fun `writer validates its column membership after a valid row`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        SqliteDatabase(store.jdbcUrl, null).use { database ->
            database.transaction { connection ->
                val reader = SqliteWorkbookReader(connection)
                val writer = SqliteWorkbookWriter(connection, reader)
                assertFailsWith<IllegalArgumentException> {
                    writer.writeCells(
                        listOf(ExpectedSheetRevision(sheet.id.value, 0)),
                        listOf(SheetCellWrite(sheet.id.value, sheet.tabularContent.rows.first().value, ColumnId.generate().value, "value")),
                    )
                }
            }
        }
    }

    @Test
    fun `aggregate updates permit an expected revision for a sheet absent from the snapshot`() = withSqliteStore { store ->
        store.saveWorkbook(testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs")))
        assertEquals(
            listOf(SheetId(TEST_SHEET_1)),
            store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_2, 0)) { it }.manifest.sheetIds,
        )
    }

    @Test
    fun `reader reports absent metadata schema versions`() = withSqliteStore { store ->
        SqliteDatabase(store.jdbcUrl, null).use { database ->
            database.transaction { connection ->
                connection.createStatement().use { it.executeUpdate("DELETE FROM workbook_metadata") }
                assertNull(SqliteWorkbookReader(connection).loadStoredSchemaVersion())
            }
        }
    }
}
