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
    fun `sqlite failure after an earlier format write rolls back every format and revision after reopen`() {
        val databasePath = Files.createTempFile("sheetspace-format-batch-", ".sqlite")
        val initial = testDocument(TEST_SHEET_1, "Formats")
        val original = testWorkbookOf(initial)
        try {
            SqliteWorkbookStore(databasePath).use { store ->
                val row = initial.tabularContent.rows[0].value
                val column = initial.tabularContent.columns[0].value
                store.saveWorkbook(original)
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
                assertEquals(original, reopened.loadWorkbookBundle())
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
    fun `invalid axis batch does not persist its preceding valid write`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Sizes")
        val unrelated = testDocument(TEST_SHEET_2, "Other")
        store.saveWorkbook(testWorkbookOf(initial, unrelated))
        val row = initial.tabularContent.rows[0].value
        val column = initial.tabularContent.columns[0].value
        val valid = AxisSizeWrite("column", column, 150.0)
        val exception = assertRejectedWithoutPersisting<WorkbookApplicationException>(store) {
            store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(valid, AxisSizeWrite("row", row, 15.0)))
        }
        assertEquals(WorkbookApplicationError.INVALID_SHEET_PRESENTATION, exception.error)
    }

    @Test
    fun `stale axis write does not overwrite persisted presentation`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Sizes")
        val unrelated = testDocument(TEST_SHEET_2, "Other")
        store.saveWorkbook(testWorkbookOf(initial, unrelated))
        val row = initial.tabularContent.rows[0].value
        val column = initial.tabularContent.columns[0].value
        val valid = AxisSizeWrite("column", column, 150.0)
        store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(valid))
        val conflict = assertRejectedWithoutPersisting<SheetRevisionConflict>(store) {
            store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), listOf(AxisSizeWrite("row", row, 40.0)))
        }
        assertEquals(TEST_SHEET_1, conflict.sheetId)
        assertEquals(0, conflict.expectedRevision)
        assertEquals(1, conflict.actualRevision)
    }

    @Test
    fun `invalid format batch does not persist its preceding valid write`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Formats")
        val unrelated = testDocument(TEST_SHEET_2, "Other")
        store.saveWorkbook(testWorkbookOf(initial, unrelated))
        val row = initial.tabularContent.rows[0].value
        val valid = FormatWrite("row", row, NumberFormat("number", 2))
        val exception = assertRejectedWithoutPersisting<WorkbookApplicationException>(store) {
            store.writePresentation(
                ExpectedSheetRevision(TEST_SHEET_1, 0),
                emptyList(),
                listOf(valid, FormatWrite("row", row, NumberFormat("percent", -1))),
            )
        }
        assertEquals(WorkbookApplicationError.INVALID_SHEET_PRESENTATION, exception.error)
    }

    @Test
    fun `stale format removal does not overwrite an existing format`() = withSqliteStore { store ->
        val initial = testDocument(TEST_SHEET_1, "Formats")
        val unrelated = testDocument(TEST_SHEET_2, "Other")
        store.saveWorkbook(testWorkbookOf(initial, unrelated))
        val row = initial.tabularContent.rows[0].value
        val format = FormatWrite("row", row, NumberFormat("number", 2))
        store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList(), listOf(format))
        val conflict = assertRejectedWithoutPersisting<SheetRevisionConflict>(store) {
            store.writePresentation(ExpectedSheetRevision(TEST_SHEET_1, 0), emptyList(), listOf(FormatWrite("row", row, null)))
        }
        assertEquals(TEST_SHEET_1, conflict.sheetId)
        assertEquals(0, conflict.expectedRevision)
        assertEquals(1, conflict.actualRevision)
        assertEquals(NumberFormat("number", 2), store.loadSheet(initial.id)!!.presentation.formatOverrides.rows[row]?.numberFormat)
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
