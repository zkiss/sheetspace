package com.sheetspace

import java.nio.ByteBuffer
import java.sql.DriverManager
import java.sql.SQLException
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SqliteWorkbookStoreSchemaTest {
    @Test
    fun `loads an empty workbook from an isolated in-memory database`() = withSqliteStore { store ->
        assertEquals(emptyWorkbookState(), store.loadWorkbook())
        assertEquals(WORKBOOK_SCHEMA_VERSION, store.loadStoredSchemaVersion())
    }

    @Test
    fun `stores UUID ids as blobs and raw formula strings in sparse cell rows`() = withSqliteStore { store ->
        val formula = "= \n SuM ( B1 , B2 )"
        store.saveWorkbook(
            testWorkbookOf(
                testDocument(
                    TEST_SHEET_1,
                    "Inputs",
                    tabular = TabularContent(cells = mapOf("A1" to formula)),
                ),
            ),
        )

        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            connection.createStatement().use { statement ->
                statement.executeQuery(
                    """
                    SELECT d.id, r.row_id, c.column_id, c.raw_content
                    FROM sheet_documents d
                    JOIN cells c ON c.sheet_id = d.id
                    JOIN sheet_rows r ON r.sheet_id = c.sheet_id AND r.row_id = c.row_id
                    """.trimIndent(),
                ).use { result ->
                    assertTrue(result.next())
                    assertEquals(16, result.getBytes("id").size)
                    assertEquals(16, result.getBytes("row_id").size)
                    assertEquals(16, result.getBytes("column_id").size)
                    assertContains(result.getString("raw_content"), "SuM")
                }
            }
        }
    }

    @Test
    fun `schema separates manifest documents frames structure and cells`() = withSqliteStore { store ->
        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            val documentColumns = buildSet {
                connection.createStatement().use { statement ->
                    statement.executeQuery("PRAGMA table_info(sheet_documents)").use { result ->
                        while (result.next()) add(result.getString("name"))
                    }
                }
            }
            assertEquals(setOf("id", "name", "content_kind", "revision"), documentColumns)
            assertFalse("cells_json" in documentColumns)
            assertFalse("row_count" in documentColumns)
            assertFalse("column_count" in documentColumns)
        }
    }

    @Test
    fun `schema rejects malformed and text sheet ids`() = withSqliteStore { store ->
        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            connection.createStatement().use { statement ->
                assertFailsWith<SQLException> {
                    statement.executeUpdate(
                        """
                        INSERT INTO sheet_documents (id, name, content_kind, revision)
                        VALUES (X'00', 'Invalid', 'TABULAR', 0)
                        """.trimIndent(),
                    )
                }
                assertFailsWith<SQLException> {
                    statement.executeUpdate(
                        """
                        INSERT INTO sheet_documents (id, name, content_kind, revision)
                        VALUES ('1234567890123456', 'Invalid Text', 'TABULAR', 0)
                        """.trimIndent(),
                    )
                }
            }
        }
    }

    @Test
    fun `schema enforces grid order and same-sheet cell ownership`() = withSqliteStore { store ->
        val first = testDocument(TEST_SHEET_1, "Inputs")
        val second = testDocument(TEST_SHEET_2, "Outputs")
        store.saveWorkbook(testWorkbookOf(first, second))

        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            connection.createStatement().use { it.execute("PRAGMA foreign_keys = ON") }
            val firstSheet = first.id.value.toTestUuidBytes()
            val secondSheet = second.id.value.toTestUuidBytes()

            assertFailsWith<SQLException> {
                connection.prepareStatement(
                    "INSERT INTO sheet_rows (sheet_id, row_id, row_order) VALUES (?, randomblob(16), 0)",
                ).use { statement ->
                    statement.setBytes(1, firstSheet)
                    statement.executeUpdate()
                }
            }

            assertFailsWith<SQLException> {
                connection.prepareStatement(
                    """
                    INSERT INTO cells (sheet_id, row_id, column_id, raw_content)
                    VALUES (
                        ?,
                        (SELECT row_id FROM sheet_rows WHERE sheet_id = ? AND row_order = 0),
                        (SELECT column_id FROM sheet_columns WHERE sheet_id = ? AND column_order = 0),
                        'cross-sheet'
                    )
                    """.trimIndent(),
                ).use { statement ->
                    statement.setBytes(1, firstSheet)
                    statement.setBytes(2, secondSheet)
                    statement.setBytes(3, firstSheet)
                    statement.executeUpdate()
                }
            }
        }
    }
}

private fun String.toTestUuidBytes(): ByteArray {
    val uuid = UUID.fromString(this)
    return ByteBuffer.allocate(16)
        .putLong(uuid.mostSignificantBits)
        .putLong(uuid.leastSignificantBits)
        .array()
}
