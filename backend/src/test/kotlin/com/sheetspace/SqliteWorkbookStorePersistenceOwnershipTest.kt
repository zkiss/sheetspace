package com.sheetspace

import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteWorkbookStorePersistenceOwnershipTest {
    @Test
    fun `aggregate updates reject calculated overrides and bound shape changes`() = withSqliteStore { store ->
        val initial = modelOwnedWorkbook()
        store.saveWorkbook(initial)
        val sheet = initial.sheetsInOrder.single()

        listOf<(WorkbookState) -> WorkbookState>(
            { workbook ->
                val current = workbook.documents.getValue(sheet.id)
                workbook.replaceSheet(current.updateTabularContent { content -> content.updateCell("B1", "=1") })
            },
            { workbook ->
                val current = workbook.documents.getValue(sheet.id)
                workbook.replaceSheet(current.updateTabularContent(TabularContent::appendColumn))
            },
        ).forEach { transform ->
            val before = store.loadWorkbookBundle()

            assertFailsWith<WorkbookApplicationException> { store.updateWorkbook(transform = transform) }

            assertEquals(before, store.loadWorkbookBundle())
        }
    }

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
                listOf(ExpectedSheetRevision(sheet.id.value, current.revision)),
                listOf(current.cellWrite("B2", "targeted")),
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

    @Test
    fun `structural insertion before and between retained records preserves final order`() = withSqliteStore { store ->
        val initial = testDocument(
            TEST_SHEET_1,
            "Inputs",
            tabular = TabularContent(rowCount = 3, columnCount = 3),
        )
        store.saveWorkbook(testWorkbookOf(initial))

        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            installWriteAudit(connection)
            val rowUpdated = initial.updateTabularContent { content ->
                TabularContent(
                    rows = listOf(RowId.generate(), content.rows[0], RowId.generate()) + content.rows.drop(1),
                    columns = content.columns,
                    cellContents = content.cellContents,
                )
            }
            store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook ->
                workbook.replaceSheet(rowUpdated)
            }
            assertEquals(setOf("sheet_documents:UPDATE", "sheet_rows:INSERT", "sheet_rows:UPDATE"), recordedWrites(connection))
            assertEquals(rowUpdated.tabularContent.rows, store.loadSheet(rowUpdated.id)!!.tabularContent.rows)

            clearAudit(connection)
            val columnUpdated = rowUpdated.updateTabularContent { content ->
                TabularContent(
                    rows = content.rows,
                    columns = listOf(ColumnId.generate(), content.columns[0], ColumnId.generate()) + content.columns.drop(1),
                    cellContents = content.cellContents,
                )
            }
            store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 1)) { workbook ->
                workbook.replaceSheet(columnUpdated)
            }
            assertEquals(
                setOf("sheet_columns:INSERT", "sheet_columns:UPDATE", "sheet_documents:UPDATE"),
                recordedWrites(connection),
            )
            val reloaded = store.loadSheet(columnUpdated.id)!!.tabularContent
            assertEquals(columnUpdated.tabularContent.rows, reloaded.rows)
            assertEquals(columnUpdated.tabularContent.columns, reloaded.columns)
        }
    }
}

private fun modelOwnedWorkbook(): WorkbookState {
    val sheet = testDocument(TEST_SHEET_1, "Inputs")
    val modelId = "00000000-0000-0000-0000-000000000101"
    val content = sheet.tabularContent
    val model = DataModel(
        modelId,
        "Metrics",
        content.columns.mapIndexed { index, _ ->
            val id = "00000000-0000-0000-0000-${(111 + index).toString().padStart(12, '0')}"
            if (index == 1) CalculatedDataModelProperty(id, "Double", "=@A[1]*2")
            else ManualDataModelProperty(id, "Column $index")
        },
    )
    val modelContents = TabularContent(
        content.rows,
        content.columns,
        content.rows.associate { row ->
            CellCoordinate(row, content.columns[1]) to "=@${content.columns[0].value}[${row.value}]*2"
        },
    )
    return testWorkbookOf(
        sheet.copy(
            dataModelId = modelId,
            content = modelContents,
        ),
    ).copy(dataModels = mapOf(modelId to model))
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
