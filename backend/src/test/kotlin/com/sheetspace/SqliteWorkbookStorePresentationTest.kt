package com.sheetspace

import java.nio.file.Files
import java.sql.DriverManager
import java.sql.SQLException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class SqliteWorkbookStorePresentationTest {
    @Test
    fun `format policy supports all valid scopes and rejects every invalid variant`() {
        val document = testDocument(TEST_SHEET_1, "Formats")
        val row = document.tabularContent.rows[0].value
        val column = document.tabularContent.columns[0].value
        val cell = "$row\u0000$column"
        val writes = listOf(
            FormatWrite("row", row, NumberFormat("general")),
            FormatWrite("column", column, NumberFormat("number", 0)),
            FormatWrite("cell", cell, NumberFormat("percent", 10)),
        )
        val formatted = validatedFormatWrites(document, writes)
        assertEquals(writes.map { it.targetId }.toSet(), (formatted.formatOverrides.rows.keys + formatted.formatOverrides.columns.keys + formatted.formatOverrides.cells.keys).toSet())
        assertEquals(SheetPresentation(), validatedFormatWrites(document.copy(presentation = formatted), writes.map { it.copy(properties = mapOf("numberFormat" to JsonNull)) }))
        listOf(
            emptyList(),
            listOf(writes[0], writes[0].copy(numberFormat = null)),
            listOf(FormatWrite("row", "missing", null)),
            listOf(FormatWrite("cell", row, null)),
            listOf(FormatWrite("other", row, null)),
            listOf(FormatWrite("row", row, NumberFormat("general", 0))),
            listOf(FormatWrite("row", row, NumberFormat("number", null))),
            listOf(FormatWrite("row", row, NumberFormat("percent", 11))),
            listOf(FormatWrite("row", row, NumberFormat("currency", 2))),
        ).forEach { invalid -> assertFailsWith<WorkbookApplicationException> { validatedFormatWrites(document, invalid) } }
    }

    @Test
    fun `appearance properties compose independently and validate complete patches`() {
        val document = testDocument(TEST_SHEET_1, "Appearance")
        val row = document.tabularContent.rows[0].value
        val column = document.tabularContent.columns[0].value
        val cell = "$row\u0000$column"
        val properties = mapOf(
            "numberFormat" to buildJsonObject { put("kind", "number"); put("precision", 2) },
            "fontWeight" to JsonPrimitive("bold"),
            "horizontalAlignment" to JsonPrimitive("center"),
            "textColor" to JsonPrimitive("#123456"),
            "fillColor" to JsonPrimitive("#abcdef"),
        )
        val styled = validatedFormatWrites(document, listOf(FormatWrite("cell", cell, properties = properties)))
        assertEquals(CellFormat(NumberFormat("number", 2), "bold", "center", "#123456", "#abcdef"), styled.formatOverrides.cells[cell])

        val retained = validatedFormatWrites(document.copy(presentation = styled), listOf(FormatWrite("cell", cell, properties = mapOf("numberFormat" to JsonNull, "textColor" to JsonNull))))
        assertEquals(CellFormat(fontWeight = "bold", horizontalAlignment = "center", fillColor = "#abcdef"), retained.formatOverrides.cells[cell])
        assertEquals(SheetPresentation(), validatedFormatWrites(document.copy(presentation = retained), listOf(FormatWrite("cell", cell, properties = mapOf("fontWeight" to JsonNull, "horizontalAlignment" to JsonNull, "fillColor" to JsonNull)))))

        listOf(
            emptyMap(),
            mapOf("numberFormat" to buildJsonObject { put("kind", "general"); put("precision", 0) }),
            mapOf("numberFormat" to buildJsonObject { put("kind", "number") }),
            mapOf("numberFormat" to JsonPrimitive("number")),
            mapOf("numberFormat" to buildJsonObject { }),
            mapOf("numberFormat" to buildJsonObject { put("kind", buildJsonObject { }) }),
            mapOf("numberFormat" to buildJsonObject { put("kind", "number"); put("precision", buildJsonObject { }) }),
            mapOf("numberFormat" to buildJsonObject { put("kind", "number"); put("precision", -1) }),
            mapOf("numberFormat" to buildJsonObject { put("kind", "percent"); put("precision", 11) }),
            mapOf("fontWeight" to JsonPrimitive("heavy")),
            mapOf("horizontalAlignment" to JsonPrimitive("justify")),
            mapOf("textColor" to JsonPrimitive("#12345")),
            mapOf("fillColor" to JsonPrimitive("transparent")),
            mapOf("unknown" to JsonPrimitive("value")),
        ).forEach { properties ->
            assertFailsWith<WorkbookApplicationException> { validatedFormatWrites(document, listOf(FormatWrite("row", row, properties = properties))) }
        }
    }

    @Test
    fun `sparse formats persist through reopen and removals preserve other scopes`() {
        val path = Files.createTempFile("sheetspace-format", ".db")
        val initial = testDocument(TEST_SHEET_1, "Formats")
        val row = initial.tabularContent.rows[0].value
        val column = initial.tabularContent.columns[0].value
        val cell = "$row\u0000$column"
        val writes = listOf(
            FormatWrite("row", row, NumberFormat("percent", 4)),
            FormatWrite("column", column, NumberFormat("number", 1)),
            FormatWrite("cell", cell, NumberFormat("general")),
        )
        try {
            SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(testWorkbookOf(initial))
                assertEquals(1, store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList(), writes).revision)
            }
            SqliteWorkbookStore(path).use { store ->
                val stored = store.loadSheet(initial.id)!!
                assertEquals(SheetFormatOverrides(
                    mapOf(row to CellFormat(NumberFormat("percent", 4))),
                    mapOf(column to CellFormat(NumberFormat("number", 1))),
                    mapOf(cell to CellFormat(NumberFormat("general"))),
                ), stored.presentation.formatOverrides)
                val removed = store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 1), emptyList(), listOf(FormatWrite("row", row, null)))
                assertEquals(2, removed.revision)
                assertEquals(emptyMap(), removed.presentation.formatOverrides.rows)
                assertEquals(NumberFormat("general"), removed.presentation.formatOverrides.cells[cell]?.numberFormat)
            }
        } finally { Files.deleteIfExists(path) }
    }

    @Test
    fun `sparse appearance properties survive reopen and property removal`() {
        val path = Files.createTempFile("sheetspace-appearance", ".db")
        val initial = testDocument(TEST_SHEET_1, "Appearance")
        val row = initial.tabularContent.rows[0].value
        val column = initial.tabularContent.columns[0].value
        val cell = "$row\u0000$column"
        try {
            SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(testWorkbookOf(initial))
                store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList(), listOf(
                    FormatWrite("row", row, properties = mapOf("fontWeight" to JsonPrimitive("normal"), "fillColor" to JsonPrimitive("none"))),
                    FormatWrite("column", column, properties = mapOf("horizontalAlignment" to JsonPrimitive("left"), "textColor" to JsonPrimitive("automatic"))),
                    FormatWrite("cell", cell, properties = mapOf("fontWeight" to JsonPrimitive("bold"), "textColor" to JsonPrimitive("#abcdef"))),
                ))
            }
            SqliteWorkbookStore(path).use { store ->
                val stored = store.loadSheet(initial.id)!!
                assertEquals(CellFormat(fontWeight = "normal", fillColor = "none"), stored.presentation.formatOverrides.rows[row])
                assertEquals(CellFormat(horizontalAlignment = "left", textColor = "automatic"), stored.presentation.formatOverrides.columns[column])
                assertEquals(CellFormat(fontWeight = "bold", textColor = "#abcdef"), stored.presentation.formatOverrides.cells[cell])
                store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 1), emptyList(), listOf(FormatWrite("cell", cell, properties = mapOf("fontWeight" to JsonNull))))
                assertEquals(CellFormat(textColor = "#abcdef"), store.loadSheet(initial.id)!!.presentation.formatOverrides.cells[cell])
            }
        } finally { Files.deleteIfExists(path) }
    }

    @Test
    fun `format validation fails before any database mutation`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Formats")
        val foreign = testDocument(TEST_SHEET_2, "Foreign")
        store.saveWorkbook(testWorkbookOf(initial, foreign))
        val row = initial.tabularContent.rows[0].value
        val column = initial.tabularContent.columns[0].value
        val valid = FormatWrite("row", row, NumberFormat("number", 2))
        listOf(
            FormatWrite("row", row, NumberFormat("general", 1)),
            FormatWrite("row", row, NumberFormat("percent", -1)),
            FormatWrite("column", row, null),
            FormatWrite("cell", "$row\u0000missing", null),
            FormatWrite("row", foreign.tabularContent.rows[0].value, null),
            FormatWrite("unknown", column, null),
        ).forEach { invalid ->
            assertFailsWith<WorkbookApplicationException> { store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList(), listOf(valid, invalid)) }
            assertEquals(initial, store.loadSheet(initial.id))
        }
        assertFailsWith<WorkbookApplicationException> { store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList(), emptyList()) }
        assertFailsWith<WorkbookApplicationException> { store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList(), listOf(valid, valid.copy(numberFormat = null))) }
        store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(AxisSizeWrite("column", column, 120.0)), listOf(valid))
        assertFailsWith<SheetRevisionConflict> { store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList(), listOf(valid.copy(numberFormat = null))) }
    }

    @Test
    fun `sqlite failure after an earlier format write rolls back every format and revision after reopen`() {
        val databasePath = Files.createTempFile("sheetspace-format-batch-", ".sqlite")
        try {
            SqliteWorkbookStore(databasePath).use { store ->
                val initial = testDocument(TEST_SHEET_1, "Formats")
                val row = initial.tabularContent.rows[0].value
                val column = initial.tabularContent.columns[0].value
                store.saveWorkbook(testWorkbookOf(initial))
                DriverManager.getConnection(store.jdbcUrl).use { connection ->
                    connection.createStatement().use { statement ->
                        statement.execute(
                            """
                            CREATE TRIGGER fail_cell_format_write
                            BEFORE INSERT ON cell_format_presentation
                            BEGIN
                                SELECT RAISE(ABORT, 'injected format failure');
                            END
                            """.trimIndent(),
                        )
                    }
                }

                assertFailsWith<SQLException> {
                    store.writePresentation(
                        ExpectedSheetRevision(TEST_SHEET_1, 0),
                        emptyList(),
                        listOf(
                            FormatWrite("row", row, NumberFormat("number", 2)),
                            FormatWrite("cell", "$row\u0000$column", NumberFormat("percent", 1)),
                        ),
                    )
                }
            }

            SqliteWorkbookStore(databasePath).use { reopened ->
                val stored = reopened.loadSheet(SheetId(TEST_SHEET_1))!!
                assertEquals(SheetPresentation(), stored.presentation)
                assertEquals(0, stored.revision)
            }
        } finally {
            Files.deleteIfExists(databasePath)
        }
    }
    @Test
    fun `sizes and targeted removal survive database reopen with cells and frame intact`() {
        val path = Files.createTempFile("sheetspace-presentation", ".db")
        val initial = testDocument(TEST_SHEET_1, "Sizes", tabular = TabularContent(cells = mapOf("A1" to "=B1", "B1" to "3")))
        val row = initial.tabularContent.rows[0].value
        val column = initial.tabularContent.columns[0].value
        try {
            SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(testWorkbookOf(initial))
                assertEquals(SheetPresentation(), store.loadSheet(initial.id)!!.presentation)
                val sized = store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(AxisSizeWrite("row", row, 40.0), AxisSizeWrite("column", column, 140.0)))
                assertEquals(1, sized.revision)
                assertEquals(initial.frame, sized.frame)
                assertEquals(initial.content, sized.content)
            }
            SqliteWorkbookStore(path).use { store ->
                assertEquals(SheetPresentation(mapOf(row to 40.0), mapOf(column to 140.0)), store.loadSheet(initial.id)!!.presentation)
                val reset = store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 1), listOf(AxisSizeWrite("row", row, null)))
                assertEquals(2, reset.revision)
                assertEquals(SheetPresentation(columnWidths = mapOf(column to 140.0)), reset.presentation)
            }
            SqliteWorkbookStore(path).use { store ->
                val reopened = store.loadSheet(initial.id)!!
                assertEquals(SheetPresentation(columnWidths = mapOf(column to 140.0)), reopened.presentation)
                assertEquals(initial.content, reopened.content)
                assertEquals(initial.frame, reopened.frame)
                assertEquals(0, store.loadManifest().revision)
            }
        } finally { Files.deleteIfExists(path) }
    }

    @Test
    fun `invalid batches and stale revision never partially mutate presentation`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Sizes")
        val foreign = testDocument(TEST_SHEET_2, "Foreign")
        store.saveWorkbook(testWorkbookOf(initial, foreign))
        val row = initial.tabularContent.rows[0].value
        val column = initial.tabularContent.columns[0].value
        val valid = AxisSizeWrite("column", column, 150.0)
        val invalid = listOf(
            AxisSizeWrite("row", row, 15.0), AxisSizeWrite("row", row, 1001.0),
            AxisSizeWrite("column", column, 23.0), AxisSizeWrite("column", column, 2001.0),
            AxisSizeWrite("row", row, Double.NaN), AxisSizeWrite("row", row, Double.POSITIVE_INFINITY),
            AxisSizeWrite("row", column, 30.0), AxisSizeWrite("column", row, null),
            AxisSizeWrite("row", foreign.tabularContent.rows[0].value, null),
            AxisSizeWrite("row", "missing", 40.0), AxisSizeWrite("cell", row, 40.0),
        )
        invalid.forEach { write ->
            assertFailsWith<WorkbookApplicationException> {
                store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(valid, write))
            }
            assertEquals(initial, store.loadSheet(initial.id))
        }
        assertFailsWith<WorkbookApplicationException> { store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList()) }
        assertFailsWith<WorkbookApplicationException> { store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(valid, valid.copy(size = null))) }
        store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(valid))
        val before = store.loadSheet(initial.id)
        assertFailsWith<SheetRevisionConflict> { store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(AxisSizeWrite("row", row, 40.0), valid.copy(size = null))) }
        assertEquals(before, store.loadSheet(initial.id))
        assertEquals(foreign, store.loadSheet(foreign.id))
    }

    @Test
    fun `presentation writes touch only their owning records and share revision with cells frame and structure`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Sizes", tabular = TabularContent(cells = mapOf("A1" to "3")))
        store.saveWorkbook(testWorkbookOf(initial))
        DriverManager.getConnection(store.jdbcUrl).use { conn ->
            conn.createStatement().use { statement ->
                listOf("frame_state", "sheet_rows", "sheet_columns", "cells", "workbook_sheets").forEach { table ->
                    listOf("INSERT", "UPDATE", "DELETE").forEach { operation ->
                        statement.execute("CREATE TRIGGER forbid_${table}_${operation.lowercase()} BEFORE $operation ON $table BEGIN SELECT RAISE(ABORT, 'unowned write'); END")
                    }
                }
            }
            val sized = store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(AxisSizeWrite("row", initial.tabularContent.rows[0].value, 16.0), AxisSizeWrite("column", initial.tabularContent.columns[0].value, 2000.0)))
            assertEquals(1, sized.revision)
            conn.createStatement().use { statement ->
                listOf("frame_state", "sheet_rows", "sheet_columns", "cells", "workbook_sheets").forEach { table ->
                    listOf("INSERT", "UPDATE", "DELETE").forEach { operation -> statement.execute("DROP TRIGGER forbid_${table}_${operation.lowercase()}") }
                }
            }
        }
        val app = DefaultWorkbookApplication(store)
        app.writeOneCell(TEST_SHEET_1, "A1", "5", 1)
        app.updateSheet(TEST_SHEET_1, 2, UpdateSheetCommand(position = WorkspacePosition(20.0, 30.0)))
        app.appendRow(TEST_SHEET_1, 3)
        app.updateSheet(TEST_SHEET_1, 4, UpdateSheetCommand(name = "Renamed"))
        app.updateSheetZOrder(listOf(SheetZOrderUpdate(TEST_SHEET_1, 5, 2)))
        val reset = app.writePresentation(TEST_SHEET_1, 6, listOf(AxisSizeWrite("row", initial.tabularContent.rows[0].value, null)))
        assertEquals(7, reset.revision)
        assertEquals("5", reset.tabularContent.cells["A1"])
        assertEquals("Renamed", reset.name)
        assertEquals(21, reset.tabularContent.rowCount)
        assertEquals(SheetPresentation(columnWidths = mapOf(initial.tabularContent.columns[0].value to 2000.0)), reset.presentation)
    }

    @Test
    fun `aggregate creation and replacement retain sparse presentation`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Sizes")
        val row = initial.tabularContent.rows[0].value
        val column = initial.tabularContent.columns[0].value
        val cell = "$row\u0000$column"
        val sized = initial.copy(presentation = SheetPresentation(
            rowHeights = mapOf(row to 1000.0),
            formatOverrides = SheetFormatOverrides(cells = mapOf(cell to CellFormat(NumberFormat("general")))),
        ))
        store.saveWorkbook(testWorkbookOf(sized))
        assertEquals(sized, store.loadSheet(initial.id))
        store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook -> workbook.replaceSheet(sized.copy(presentation = SheetPresentation())) }
        assertEquals(SheetPresentation(), store.loadSheet(initial.id)!!.presentation)
    }
}
