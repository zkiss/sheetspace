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
                        ),
                    ),
                )
                assertEquals(
                    1,
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
}
