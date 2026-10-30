package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class RecordAdmissionTest {
    private val modelId = "10000000-0000-0000-0000-000000000001"
    private val propertyId = "10000000-0000-0000-0000-000000000002"
    private val sheetId = SheetId("10000000-0000-0000-0000-000000000003")

    private fun workbook(type: ModelColumnType = ModelColumnType.INT): WorkbookState {
        val column = ColumnId.generate()
        val sheet = SheetDocument(id = sheetId, name = "Records", content = TabularContent(emptyList(), listOf(column), emptyMap()), modelId = modelId, modelColumnBindings = mapOf(propertyId to column))
        return emptyWorkbookState().addSheet(sheet).copy(dataModels = mapOf(modelId to DataModel(modelId, "Model", listOf(ManualModelColumn(propertyId, "Value", type)))))
    }

    @Test
    fun `admission persists a complete record and safely retries the same identity`() = withSqliteStore { store ->
        store.saveWorkbook(workbook())
        val app = DefaultWorkbookApplication(store)
        val row = RowId.generate().value
        val first = app.admitRecord(sheetId.value, 0, row, mapOf(propertyId to "42"))
        val retry = app.admitRecord(sheetId.value, 0, row, mapOf(propertyId to "42"))
        assertEquals(first.sheet, retry.sheet)
        assertEquals("42", retry.sheet.tabularContent.cells["A1"])
        assertFailsWith<WorkbookApplicationException> { app.admitRecord(sheetId.value, 0, row, mapOf(propertyId to "43")) }
        val second = app.admitRecord(sheetId.value, first.sheet.revision, RowId.generate().value, mapOf(propertyId to ""))
        assertEquals(2, second.sheet.tabularContent.rowCount)
        assertEquals(second.sheet, store.loadSheet(sheetId))
    }

    @Test
    fun `invalid submissions and stale revisions leave the sheet untouched`() = withSqliteStore { store ->
        store.saveWorkbook(workbook())
        val app = DefaultWorkbookApplication(store)
        val before = store.loadSheet(sheetId)!!
        listOf(emptyMap(), mapOf(propertyId to "oops"), mapOf("unknown" to "1")).forEach { values ->
            assertFailsWith<WorkbookApplicationException> { app.admitRecord(sheetId.value, before.revision, RowId.generate().value, values) }
        }
        assertFailsWith<WorkbookApplicationException> { app.admitRecord(sheetId.value, 0, "invalid", mapOf(propertyId to "1")) }
        assertFailsWith<WorkbookApplicationException> { app.admitRecord(sheetId.value, -1, RowId.generate().value, mapOf(propertyId to "1")) }
        assertFailsWith<WorkbookApplicationException> { app.admitRecord(RowId.generate().value, 0, RowId.generate().value, mapOf(propertyId to "1")) }
        assertFailsWith<SheetRevisionConflict> { app.admitRecord(sheetId.value, 99, RowId.generate().value, mapOf(propertyId to "1")) }
        assertEquals(before, store.loadSheet(sheetId))
    }

    @Test
    fun `missing model or binding cannot admit a record`() {
        val original = workbook()
        val sheet = original.documents.getValue(sheetId)
        listOf(sheet.copy(modelId = null, modelColumnBindings = emptyMap()), sheet.copy(modelColumnBindings = emptyMap())).forEach { invalid ->
            val app = DefaultWorkbookApplication(InMemoryWorkbookStore(original.replaceSheet(invalid)))
            assertFailsWith<WorkbookApplicationException> { app.admitRecord(sheetId.value, 0, RowId.generate().value, mapOf(propertyId to "1")) }
        }
    }

    @Test
    fun `storage failure leaves the record uncommitted`() {
        var reject = false
        SqliteWorkbookStore.inMemory(calculatedAdmission = { _, _ -> if (reject) error("storage failure") }).use { store ->
            store.saveWorkbook(workbook())
            reject = true
            val app = DefaultWorkbookApplication(store)
            assertRejectedWithoutPersisting<IllegalStateException>(store) {
                app.admitRecord(sheetId.value, 0, RowId.generate().value, mapOf(propertyId to "4"))
            }
        }
    }

    @Test
    fun `bound structure cannot be appended while unbound structure remains available`() {
        val store = InMemoryWorkbookStore(workbook())
        val app = DefaultWorkbookApplication(store)
        assertFailsWith<WorkbookApplicationException> { app.appendRow(sheetId.value, 0) }
        assertFailsWith<WorkbookApplicationException> { app.appendColumn(sheetId.value, 0) }
        val unbound = app.createSheet(CreateSheetCommand("Free"))
        val row = app.appendRow(unbound.id.value, unbound.revision)
        assertTrue(row.rowId in row.sheet.tabularContent.rows)
        val column = app.appendColumn(unbound.id.value, row.sheet.revision)
        assertTrue(column.columnId in app.loadSheet(unbound.id.value).tabularContent.columns)
    }

    @Test
    fun `declared types accept empty values and reject invalid values`() {
        val cases = listOf(ModelColumnType.STRING to "anything", ModelColumnType.INT to "12", ModelColumnType.FLOAT to "1.5", ModelColumnType.BOOLEAN to "TRUE")
        cases.forEach { (type, value) ->
            val app = DefaultWorkbookApplication(InMemoryWorkbookStore(workbook(type)))
            val first = app.admitRecord(sheetId.value, 0, RowId.generate().value, mapOf(propertyId to value))
            val emptyRow = RowId.generate().value
            app.admitRecord(sheetId.value, first.sheet.revision, emptyRow, mapOf(propertyId to ""))
            app.admitRecord(sheetId.value, first.sheet.revision, emptyRow, mapOf(propertyId to ""))
            if (type != ModelColumnType.STRING) assertFailsWith<WorkbookApplicationException> { app.admitRecord(sheetId.value, 2, RowId.generate().value, mapOf(propertyId to "bad")) }
        }
    }

    @Test
    fun `record types follow spreadsheet literal classification`() {
        val cases = listOf(
            Triple(ModelColumnType.STRING, "\"12\"", true),
            Triple(ModelColumnType.STRING, "12", false),
            Triple(ModelColumnType.STRING, "TRUE", false),
            Triple(ModelColumnType.INT, "1.5", false),
            Triple(ModelColumnType.INT, " 1e2 ", true),
            Triple(ModelColumnType.INT, "\"1\"", false),
            Triple(ModelColumnType.FLOAT, "1e999", false),
            Triple(ModelColumnType.FLOAT, "\"1\"", false),
            Triple(ModelColumnType.BOOLEAN, " false ", true),
            Triple(ModelColumnType.BOOLEAN, "\"true\"", false),
            Triple(ModelColumnType.INT, "=1+1", true),
        )
        cases.forEach { (type, value, valid) ->
            val app = DefaultWorkbookApplication(InMemoryWorkbookStore(workbook(type)))
            val action = { app.admitRecord(sheetId.value, 0, RowId.generate().value, mapOf(propertyId to value)) }
            if (valid) action() else assertFailsWith<WorkbookApplicationException> { action() }
        }
    }
}
