package com.sheetspace

import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.sql.DriverManager
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RecordFormulaValidationTest {
    private val modelId = "10000000-0000-0000-0000-000000000001"
    private val property = "10000000-0000-0000-0000-000000000002"
    private val sheetId = SheetId("10000000-0000-0000-0000-000000000003")

    private fun workbook(type: ModelColumnType = ModelColumnType.INT): WorkbookState {
        val column = ColumnId.generate()
        val sheet = SheetDocument(id = sheetId, name = "Records", content = TabularContent(emptyList(), listOf(column), emptyMap()), modelId = modelId, modelColumnBindings = mapOf(property to column))
        return emptyWorkbookState().addSheet(sheet).copy(dataModels = mapOf(modelId to DataModel(modelId, "Model", listOf(ManualModelColumn(property, "Value", type)))))
    }

    @Test
    fun `JVM runtime shares scalar function and error semantics rather than accepting formula prefixes`() {
        val cases = listOf(
            Triple(ModelColumnType.INT, "=1+2*3", true),
            Triple(ModelColumnType.INT, "=-(2+4)/3", true),
            Triple(ModelColumnType.INT, "=1/2", false),
            Triple(ModelColumnType.FLOAT, "=1/2", true),
            Triple(ModelColumnType.STRING, "=\"text\"", true),
            Triple(ModelColumnType.BOOLEAN, "=1<2", true),
            Triple(ModelColumnType.INT, "=TRUE", false),
            Triple(ModelColumnType.INT, "=", false),
            Triple(ModelColumnType.INT, "=1+", false),
            Triple(ModelColumnType.INT, "=1/0", false),
            Triple(ModelColumnType.INT, "=ABS()", false),
            Triple(ModelColumnType.INT, "=ABS(1,2)", false),
            Triple(ModelColumnType.INT, "=UNKNOWN(1)", false),
            Triple(ModelColumnType.INT, "=IFERROR(1/0,1)", false),
            Triple(ModelColumnType.INT, "=1+\"2\"", false),
            Triple(ModelColumnType.INT, "=SQRT(-1)", false),
            Triple(ModelColumnType.INT, "=IF(TRUE,2,1/0)", true),
            Triple(ModelColumnType.INT, "=IF(FALSE,1/0,2)", true),
            Triple(ModelColumnType.BOOLEAN, "=OR(TRUE,1/0)", true),
            Triple(ModelColumnType.BOOLEAN, "=AND(TRUE,NOT(FALSE))", true),
            Triple(ModelColumnType.INT, "=SUM(1,2)+AVERAGE(2,4)+MIN(1,2)+MAX(1,2)+COUNT(1,2)+COUNTA(1,TRUE)+ABS(-2)+SQRT(4)", true),
            Triple(ModelColumnType.INT, "=~{broken}", false),
            Triple(ModelColumnType.INT, "=~{0041}+1", false),
            Triple(ModelColumnType.INT, "=@A[1]", false),
            Triple(ModelColumnType.STRING, "=\"@A[1]\"", true),
            Triple(ModelColumnType.INT, "=globalThis.process.exit()", false),
        )
        cases.forEach { (type, content, expected) ->
            assertEquals(expected, SharedRecordValueValidation.valid(workbook(type), sheetId, mapOf(property to content)), "$type $content")
        }
    }

    @Test
    fun `canonical references follow committed ordered ranges and typed transitive dependencies`() {
        val initial = workbook()
        val source = SheetDocument(id = SheetId.generate(), name = "Source", content = TabularContent(rowCount = 3, columnCount = 2))
        val rows = source.tabularContent.rows
        val columns = source.tabularContent.columns
        fun reference(row: Int, column: Int = 0) = "@${source.id.value}!${columns[column].value}[${rows[row].value}]"
        val inputs = mapOf(
            CellCoordinate(rows[0], columns[0]) to "2",
            CellCoordinate(rows[1], columns[0]) to "4",
            CellCoordinate(rows[0], columns[1]) to "=${reference(0)}*2",
            CellCoordinate(rows[1], columns[1]) to "text",
        )
        val workbook = initial.addSheet(source.copy(content = TabularContent(rows, columns, inputs)))
        fun valid(content: String, current: WorkbookState = workbook) = SharedRecordValueValidation.valid(current, sheetId, mapOf(property to content))
        val range = "${reference(0)}:${columns[0].value}[${rows[2].value}]"
        assertTrue(valid("=${reference(0, 1)}"))
        assertTrue(valid("=${reference(2)}"))
        assertTrue(valid("=SUM($range)"))
        assertTrue(valid("=COUNTIF($range,\">2\")"))
        assertTrue(valid("=SUMIF($range,\">2\")"))
        assertFalse(valid("=$range"))
        assertFalse(valid("=@${source.id.value}!${columns[0].value}[${RowId.generate().value}]"))
        val cyclic = workbook.replaceSheet(source.copy(content = TabularContent(rows, columns, inputs + (CellCoordinate(rows[0], columns[0]) to "=${reference(0, 1)}"))))
        assertFalse(valid("=${reference(0)}", cyclic))
        assertTrue(valid("=IF(TRUE,1,${reference(0)})", cyclic))
        val reordered = workbook.replaceSheet(source.copy(content = TabularContent(rows.reversed(), columns, inputs)))
        assertTrue(valid("=SUM($range)", reordered))
    }

    @Test
    fun `real store rejection is atomic and exact formula retry never revalidates changed dependencies`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val source = SheetDocument(id = SheetId.generate(), name = "Source", content = TabularContent(rowCount = 1, columnCount = 1))
            val coordinate = CellCoordinate(source.tabularContent.rows.single(), source.tabularContent.columns.single())
            val withValue = source.copy(content = TabularContent(source.tabularContent.rows, source.tabularContent.columns, mapOf(coordinate to "3")))
            store.saveWorkbook(workbook().addSheet(withValue))
            val app = DefaultWorkbookApplication(store)
            val before = store.loadWorkbookBundle()
            val row = RowId.generate()
            val column = before.documents.getValue(sheetId).tabularContent.columns.single()
            for (content in listOf("=", "=1+", "=1/0", "=\"wrong\"", "=@${column.value}[${row.value}]")) {
                val failure = assertFailsWith<WorkbookApplicationException> { app.admitRecord(sheetId.value, 0, row.value, mapOf(property to content)) }
                assertEquals(WorkbookApplicationError.INVALID_MODEL_RECORD, failure.error)
                assertEquals(before, store.loadWorkbookBundle())
                assertEquals(0, receipts(store))
            }
            val expression = "=@${source.id.value}!${coordinate.columnId.value}[${coordinate.rowId.value}]"
            val first = app.admitRecord(sheetId.value, 0, row.value, mapOf(property to expression))
            assertEquals(expression, first.sheet.tabularContent.cellContents.getValue(CellCoordinate(row, column)))
            assertEquals(1, receipts(store))
            app.writeCells(CellPatchCommand(listOf(ExpectedSheetRevision(source.id.value, source.revision)), listOf(SheetCellWrite(source.id.value, coordinate.rowId.value, coordinate.columnId.value, "wrong type"))))
            assertEquals(first.sheet, app.admitRecord(sheetId.value, 0, row.value, mapOf(property to expression)).sheet)
            assertFailsWith<WorkbookApplicationException> { app.admitRecord(sheetId.value, first.sheet.revision, RowId.generate().value, mapOf(property to expression)) }
            assertEquals(1, receipts(store))
            assertEquals(1, store.loadSheet(sheetId)!!.tabularContent.rowCount)
        }
    }

    @Test
    fun `admission can depend on an existing calculated property and materializes the new calculated row`() {
        SqliteWorkbookStore.inMemory().use { store ->
            store.saveWorkbook(lifecycleBoundWorkbook(lifecycleWorkbook()))
            val sheet = store.loadWorkbookBundle().sheetsInOrder.first()
            val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
            val expression = "=@${output.value}[${sheet.tabularContent.rows.first().value}]"
            val row = RowId.generate()
            val result = DefaultWorkbookApplication(store).admitRecord(sheet.id.value, sheet.revision, row.value, mapOf(LIFECYCLE_INPUT to expression))
            assertEquals(3, result.sheet.tabularContent.rowCount)
            assertEquals(expression, result.sheet.tabularContent.cellContents.getValue(CellCoordinate(row, sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT))))
            assertTrue(result.sheet.tabularContent.cellContents.getValue(CellCoordinate(row, output)).startsWith("="))
        }
    }

    @Test
    fun `direct HTTP formula submission cannot bypass validation or persist a failed receipt`() {
        SqliteWorkbookStore.inMemory().use { store ->
            store.saveWorkbook(workbook())
            testApplication {
                application { module(DefaultWorkbookApplication(store)) }
                val before = store.loadWorkbookBundle()
                val row = RowId.generate().value
                for (formula in listOf("=", "=1/0", "=TRUE")) {
                    val response = client.post("/api/sheets/${sheetId.value}/records") {
                        header("If-Match", 0)
                        jsonBody(Json.encodeToString(RecordAdmissionRequest(row, mapOf(property to formula))))
                    }
                    assertEquals(HttpStatusCode.BadRequest, response.status)
                    assertEquals(before, store.loadWorkbookBundle())
                    assertEquals(0, receipts(store))
                }
                val accepted = client.post("/api/sheets/${sheetId.value}/records") {
                    header("If-Match", 0)
                    jsonBody(Json.encodeToString(RecordAdmissionRequest(row, mapOf(property to "=IF(TRUE,2,1/0)"))))
                }
                assertEquals(HttpStatusCode.OK, accepted.status)
                assertEquals(1, receipts(store))
            }
        }
    }

    private fun receipts(store: SqliteWorkbookStore): Int = DriverManager.getConnection(store.jdbcUrl).use { connection ->
        connection.createStatement().use { statement -> statement.executeQuery("SELECT COUNT(*) FROM record_admissions").use { result -> result.next(); result.getInt(1) } }
    }
}
