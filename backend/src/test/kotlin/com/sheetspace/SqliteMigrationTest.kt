package com.sheetspace

import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SqliteMigrationTest {
    @Test
    fun `fresh database uses one normalized reset baseline`() {
        SqliteWorkbookStore.inMemory().use { store ->
            assertEquals(emptyWorkbookState(), store.loadWorkbookBundle())
            assertEquals(WORKBOOK_SCHEMA_VERSION, store.loadStoredSchemaVersion())

            DriverManager.getConnection(store.jdbcUrl).use { connection ->
                val tables = connection.createStatement().use { statement ->
                    statement.executeQuery(
                        """
                        SELECT name
                        FROM sqlite_master
                        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                        """.trimIndent(),
                    ).use { result ->
                        buildSet {
                            while (result.next()) add(result.getString("name"))
                        }
                    }
                }
                assertTrue(
                    tables.containsAll(
                        setOf(
                            "workbook_metadata",
                            "workbook_sheets",
                            "sheet_documents",
                            "frame_state",
                            "sheet_rows",
                            "sheet_columns",
                            "cells",
                            "row_format_presentation",
                            "column_format_presentation",
                            "cell_format_presentation",
                        ),
                    ),
                )
                assertEquals(
                    3,
                    connection.createStatement().use { statement ->
                        statement.executeQuery("SELECT COUNT(*) FROM flyway_schema_history").use { result ->
                            result.next()
                            result.getInt(1)
                        }
                    },
                )
            }
        }
    }

    @Test
    fun `current schema supplies default visual scale for SQL frame inserts`() = withSqliteStore { store ->
        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            val sheetId = TEST_SHEET_1.toUuidBytes()
            connection.prepareStatement(
                "INSERT INTO sheet_documents (id, name, content_kind) VALUES (?, 'Inputs', 'TABULAR')",
            ).use { statement ->
                statement.setBytes(1, sheetId)
                statement.executeUpdate()
            }
            connection.prepareStatement(
                "INSERT INTO workbook_sheets (sheet_id, sheet_order) VALUES (?, 0)",
            ).use { statement ->
                statement.setBytes(1, sheetId)
                statement.executeUpdate()
            }
            connection.prepareStatement(
                "INSERT INTO frame_state (sheet_id, position_x, position_y, frame_width, frame_height, z_index) VALUES (?, 10, 20, 320, 220, 1)",
            ).use { statement ->
                statement.setBytes(1, sheetId)
                statement.executeUpdate()
            }
        }

        assertEquals(1.0, store.loadSheet(SheetId(TEST_SHEET_1))!!.frame.visualScale)
    }
}
