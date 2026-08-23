package com.sheetspace

import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals

class SqliteWorkbookStorePersistenceOwnershipTest {
    @Test
    fun `ordinary sheet mutations write only their owned SQLite records`() = withSqliteStore { store ->
        val sheet = testDocument(
            TEST_SHEET_1,
            "Inputs",
            tabular = TabularContent(cells = mapOf("A1" to "existing")),
        )
        store.saveWorkbook(testWorkbookOf(sheet))
        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            installWriteAudit(connection)

            store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook ->
                workbook.replaceSheet(workbook.documents.getValue(sheet.id).rename("Renamed"))
            }
            assertEquals(setOf("sheet_documents:UPDATE"), recordedWrites(connection))

            clearAudit(connection)
            store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 1)) { workbook ->
                workbook.replaceSheet(
                    workbook.documents.getValue(sheet.id).updateFrame {
                        it.update(position = WorkspacePosition(10.0, 20.0))
                    },
                )
            }
            assertEquals(setOf("frame_state:UPDATE", "sheet_documents:UPDATE"), recordedWrites(connection))

            clearAudit(connection)
            store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 2)) { workbook ->
                workbook.replaceSheet(
                    workbook.documents.getValue(sheet.id).updateTabularContent(TabularContent::appendRow),
                )
            }
            assertEquals(setOf("sheet_documents:UPDATE", "sheet_rows:INSERT"), recordedWrites(connection))

            clearAudit(connection)
            store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 3)) { workbook ->
                workbook.replaceSheet(
                    workbook.documents.getValue(sheet.id).updateTabularContent(TabularContent::appendColumn),
                )
            }
            assertEquals(setOf("sheet_columns:INSERT", "sheet_documents:UPDATE"), recordedWrites(connection))

            clearAudit(connection)
            val current = store.loadSheet(sheet.id)!!
            store.writeCells(
                ExpectedSheetRevision(sheet.id.value, current.revision),
                listOf(CellWrite(current.tabularContent.coordinateAt("B2")!!, "targeted")),
            )
            assertEquals(setOf("cells:INSERT", "sheet_documents:UPDATE"), recordedWrites(connection))
        }
    }

    @Test
    fun `structural deletion followed by append compacts row and column orders`() = withSqliteStore { store ->
        val initial = testDocument(
            TEST_SHEET_1,
            "Inputs",
            tabular = TabularContent(rowCount = 3, columnCount = 3),
        )
        store.saveWorkbook(testWorkbookOf(initial))

        val rowUpdated = initial.updateTabularContent { content ->
            val removedRow = content.rows[1]
            TabularContent(
                rows = content.rows.filterNot { it == removedRow } + RowId.generate(),
                columns = content.columns,
                cellContents = content.cellContents.filterKeys { it.rowId != removedRow },
            )
        }
        store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook ->
            workbook.replaceSheet(rowUpdated)
        }
        assertEquals(rowUpdated.tabularContent.rows, store.loadSheet(rowUpdated.id)!!.tabularContent.rows)

        val columnUpdated = rowUpdated.updateTabularContent { content ->
            val removedColumn = content.columns[1]
            TabularContent(
                rows = content.rows,
                columns = content.columns.filterNot { it == removedColumn } + ColumnId.generate(),
                cellContents = content.cellContents.filterKeys { it.columnId != removedColumn },
            )
        }
        store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 1)) { workbook ->
            workbook.replaceSheet(columnUpdated)
        }
        val reloaded = store.loadSheet(columnUpdated.id)!!.tabularContent
        assertEquals(columnUpdated.tabularContent.rows, reloaded.rows)
        assertEquals(columnUpdated.tabularContent.columns, reloaded.columns)
    }
}

private fun installWriteAudit(connection: java.sql.Connection) {
    connection.createStatement().use { statement ->
        statement.execute("CREATE TABLE write_audit (entry TEXT NOT NULL)")
        listOf("sheet_documents", "frame_state", "sheet_rows", "sheet_columns", "cells", "workbook_sheets").forEach { table ->
            listOf("INSERT", "UPDATE", "DELETE").forEach { operation ->
                statement.execute(
                    "CREATE TRIGGER audit_${table}_${operation.lowercase()} AFTER $operation ON $table " +
                        "BEGIN INSERT INTO write_audit VALUES ('$table:$operation'); END",
                )
            }
        }
    }
}

private fun clearAudit(connection: java.sql.Connection) {
    connection.createStatement().use { it.executeUpdate("DELETE FROM write_audit") }
}

private fun recordedWrites(connection: java.sql.Connection): Set<String> =
    connection.createStatement().use { statement ->
        statement.executeQuery("SELECT entry FROM write_audit").use { results ->
            buildSet {
                while (results.next()) add(results.getString("entry"))
            }
        }
    }
