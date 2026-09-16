package com.sheetspace

import java.nio.file.Files
import java.sql.DriverManager
import java.sql.SQLException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteWorkbookStoreCellWriteTest {
    @Test
    fun `prepared batch cell write changes one sheet revision and leaves manifest untouched`() =
        withSqliteStore { store ->
            val first = testDocument(TEST_SHEET_1, "Inputs")
            val second = testDocument(TEST_SHEET_2, "Outputs")
            store.saveWorkbook(testWorkbookOf(first, second))
            val updated = store.writeCells(
                listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
                listOf(
                    first.cellWrite("A1", "raw"),
                    first.cellWrite("B2", "=A1"),
                ),
            ).single()

            assertEquals(mapOf("A1" to "raw", "B2" to "=A1"), updated.tabularContent.cells)
            assertEquals(1, updated.revision)
            assertEquals(0, store.loadSheet(SheetId(TEST_SHEET_2))!!.revision)
            assertEquals(0, store.loadManifest().revision)
        }

    @Test
    fun `canonical formula content survives sqlite round trip byte for byte`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Outputs")
        val canonical =
            "= SUM( 'sheet-inputs'!@[\$column-a,row-a]:@[column-b,\$row-b], @[column-c,row-c] )"
        store.saveWorkbook(testWorkbookOf(sheet))

        store.writeCells(
            listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
            listOf(sheet.cellWrite("A1", canonical)),
        )

        assertEquals(canonical, store.loadSheet(SheetId(TEST_SHEET_1))!!.tabularContent.cells.getValue("A1"))
    }

    @Test
    fun `stale batch cell write is atomic`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        store.writeCells(
            listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
            listOf(sheet.cellWrite("A1", "newer")),
        )

        assertFailsWith<SheetRevisionConflict> {
            store.writeCells(
                listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)),
                listOf(sheet.cellWrite("A1", "stale")),
            )
        }

        assertEquals("newer", store.loadSheet(SheetId(TEST_SHEET_1))!!.tabularContent.cells.getValue("A1"))
    }

    @Test
    fun `sqlite failure after an earlier sheet write rolls back every cell and revision after reopen`() {
        val databasePath = Files.createTempFile("sheetspace-cell-batch-", ".sqlite")
        try {
            SqliteWorkbookStore(databasePath).use { store ->
                val first = testDocument(TEST_SHEET_1, "Inputs")
                val second = testDocument(TEST_SHEET_2, "Outputs")
                store.saveWorkbook(testWorkbookOf(first, second))
                DriverManager.getConnection(store.jdbcUrl).use { connection ->
                    connection.createStatement().use { statement ->
                        statement.execute(
                            """
                            CREATE TRIGGER fail_second_cell_batch
                            BEFORE UPDATE OF revision ON sheet_documents
                            WHEN OLD.id = X'00000000000000000000000000000002'
                            BEGIN
                                SELECT RAISE(ABORT, 'injected second-sheet failure');
                            END
                            """.trimIndent(),
                        )
                    }
                }

                assertFailsWith<SQLException> {
                    store.writeCells(
                        listOf(
                            ExpectedSheetRevision(TEST_SHEET_1, 0),
                            ExpectedSheetRevision(TEST_SHEET_2, 0),
                        ),
                        listOf(first.cellWrite("A1", "source"), second.cellWrite("A1", "result")),
                    )
                }
            }

            SqliteWorkbookStore(databasePath).use { reopened ->
                val first = reopened.loadSheet(SheetId(TEST_SHEET_1))!!
                val second = reopened.loadSheet(SheetId(TEST_SHEET_2))!!

                assertEquals(emptyMap(), first.tabularContent.cells)
                assertEquals(emptyMap(), second.tabularContent.cells)
                assertEquals(0, first.revision)
                assertEquals(0, second.revision)
            }
        } finally {
            Files.deleteIfExists(databasePath)
        }
    }
}
