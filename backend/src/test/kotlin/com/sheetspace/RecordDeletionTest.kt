package com.sheetspace

import java.sql.DriverManager
import java.sql.SQLException
import java.nio.file.Files
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RecordDeletionTest {
    @Test
    fun `deletion drops row presentation while preserving surviving presentation`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val sheet = store.loadSheet(scenario.target.id)!!
        val column = sheet.tabularContent.columns.first()
        val cell = "${scenario.row.value}\u0000${column.value}"
        store.writePresentation(ExpectedSheetRevision(sheet.id.value, sheet.revision), listOf(AxisSizeWrite("row", scenario.row.value, 40.0)), listOf(
            FormatWrite("row", scenario.row.value, properties = mapOf("fontWeight" to kotlinx.serialization.json.JsonPrimitive("bold"))),
            FormatWrite("cell", cell, properties = mapOf("fontWeight" to kotlinx.serialization.json.JsonPrimitive("bold"))),
        ))
        val before = store.loadWorkbookBundle()
        val request = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before))
        scenario.app.deleteRecord(sheet.id.value, scenario.row.value, request)
        val after = store.loadSheet(sheet.id)!!
        assertFalse(scenario.row.value in after.presentation.rowHeights)
        assertFalse(scenario.row.value in after.presentation.formatOverrides.rows)
        assertFalse(cell in after.presentation.formatOverrides.cells)
        assertEquals(sheet.presentation.columnWidths, after.presentation.columnWidths)
    }

    @Test
    fun `matching receipt survives reopen and returns current workbook after later edits`() {
        val directory = Files.createTempDirectory("record-deletion")
        val path = directory.resolve("workbook.db")
        try {
            lateinit var request: RecordDeletionRequest
            lateinit var sheetId: String
            lateinit var rowId: String
            SqliteWorkbookStore(path).use { store ->
                val scenario = AtomicAdmissionScenario(store)
                scenario.admit()
                sheetId = scenario.target.id.value
                rowId = scenario.row.value
                request = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()))
                scenario.app.deleteRecord(sheetId, rowId, request)
            }
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                val sheet = store.loadSheet(SheetId(sheetId))!!
                store.writePresentation(ExpectedSheetRevision(sheetId, sheet.revision), listOf(AxisSizeWrite("row", sheet.tabularContent.rows.first().value, 42.0)))
                val current = store.loadWorkbookBundle()
                val retry = app.deleteRecord(sheetId, rowId, request)
                assertTrue(retry.alreadyCommitted)
                assertEquals(WorkbookReadTransportAdapter.bundle(current), retry.workbook)
                assertFailsWith<WorkbookApplicationException> { app.deleteRecord(sheetId, rowId, request.copy(before = WorkbookReadTransportAdapter.bundle(current))) }
            }
        } finally {
            path.toFile().delete()
            directory.toFile().delete()
        }
    }

    @Test
    fun `store boundary rejects injected calculated writes in surviving rows`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val before = store.loadWorkbookBundle()
        val request = prepareRecordDeletion(scenario.target.id.value, scenario.row.value, RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before)))
        assertFailsWith<WorkbookApplicationException> {
            store.deleteRecord(request) { current ->
                val stages = deleteRecord(current, request)
                val sheet = stages.ordered.findSheet(scenario.target.id)!!
                val cell = CellCoordinate(sheet.tabularContent.rows.first(), sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT))
                val content = sheet.tabularContent
                val injected = stages.ordered.replaceSheet(sheet.copy(content = TabularContent(content.rows, content.columns, content.cellContents + (cell to "=1"))))
                RecordAdmissionStages(stages.appended, injected)
            }
        }
        assertEquals(before, store.loadWorkbookBundle())
        assertEquals(0, replayReceipts(store))
    }
    @Test
    fun `capture removes only the selected row and persists actual endpoints and receipt`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val before = store.loadWorkbookBundle()
        val target = before.findSheet(scenario.target.id)!!
        val other = before.findSheet(scenario.other.id)!!
        val request = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), listOf(
            RecordRowOrder(other.id.value, other.tabularContent.rows.reversed().map { it.value }),
        ))
        val result = scenario.app.deleteRecord(target.id.value, scenario.row.value, request)
        val after = store.loadWorkbookBundle()
        assertFalse(result.alreadyCommitted)
        assertEquals(request.operationId, result.deletionId)
        assertEquals(WorkbookReadTransportAdapter.bundle(after), result.workbook)
        assertEquals(target.tabularContent.rows - scenario.row, after.findSheet(target.id)!!.tabularContent.rows)
        assertTrue(after.findSheet(target.id)!!.tabularContent.cellContents.keys.none { it.rowId == scenario.row })
        assertEquals(other.tabularContent.rows.reversed(), after.findSheet(other.id)!!.tabularContent.rows)
        assertEquals(before.findSheet(scenario.untouched.id)!!.revision, after.findSheet(scenario.untouched.id)!!.revision)
        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT before_workbook, after_workbook FROM record_deletions").use { rows ->
                    assertTrue(rows.next())
                    assertEquals(WorkbookReadTransportAdapter.bundle(before), kotlinx.serialization.json.Json.decodeFromString<WorkbookBundleResponse>(rows.getString(1)))
                    assertEquals(WorkbookReadTransportAdapter.bundle(after), kotlinx.serialization.json.Json.decodeFromString<WorkbookBundleResponse>(rows.getString(2)))
                    assertFalse(rows.next())
                }
            }
        }
        assertTrue(scenario.app.deleteRecord(target.id.value.uppercase(), scenario.row.value.uppercase(), request.copy(operationId = request.operationId.uppercase())).alreadyCommitted)
        assertFailsWith<WorkbookApplicationException> { scenario.app.deleteRecord(target.id.value, RowId.generate().value, request) }
        assertEquals(after, store.loadWorkbookBundle())
    }

    @Test
    fun `bad guards orders and row identities cannot change the workbook`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val before = store.loadWorkbookBundle()
        val target = before.findSheet(scenario.target.id)!!
        val row = target.tabularContent.rows.first()
        val request = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before))
        assertFailsWith<WorkbookApplicationException> { scenario.app.deleteRecord(target.id.value, RowId.generate().value, request) }
        assertFailsWith<WorkbookApplicationException> { scenario.app.deleteRecord(target.id.value, row.value, request.copy(rowOrders = listOf(RecordRowOrder(target.id.value, emptyList()))) ) }
        assertFailsWith<WorkbookApplicationException> { scenario.app.deleteRecord(target.id.value, row.value, request.copy(rowOrders = listOf(RecordRowOrder(target.id.value, emptyList()), RecordRowOrder(target.id.value.uppercase(), emptyList())))) }
        assertFailsWith<WorkbookApplicationException> { scenario.app.deleteRecord(target.id.value, row.value, request.copy(before = request.before.copy(manifest = request.before.manifest.copy(revision = request.before.manifest.revision + 1)))) }
        assertEquals(before, store.loadWorkbookBundle())
        assertEquals(0, replayReceipts(store))
    }

    @Test
    fun `failed authority or receipt insertion rolls back the entire deletion`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        scenario.admit()
        val before = store.loadWorkbookBundle()
        val request = RecordDeletionRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before))
        listOf("record_deletions", "record_replays").forEach { table ->
            admissionSql(store, "CREATE TRIGGER fail_capture BEFORE INSERT ON $table BEGIN SELECT RAISE(ABORT, 'failed'); END")
            assertFailsWith<SQLException> { scenario.app.deleteRecord(scenario.target.id.value, scenario.row.value, request) }
            admissionSql(store, "DROP TRIGGER fail_capture")
            assertEquals(before, store.loadWorkbookBundle())
            assertEquals(0, replayReceipts(store))
        }
    }
}
