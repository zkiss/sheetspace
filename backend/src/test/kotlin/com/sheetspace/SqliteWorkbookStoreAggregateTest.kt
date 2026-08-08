package com.sheetspace

import java.nio.file.Files
import java.sql.DriverManager
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SqliteWorkbookStoreAggregateTest {
    @Test
    fun `malformed sheet id is treated as absent`() = withSqliteStore { store ->
        assertNull(store.loadSheet(SheetId("missing")))
    }

    @Test
    fun `aggregate read stays on one snapshot during concurrent membership change`() {
        val database = Files.createTempFile("sheetspace-snapshot-", ".db")
        try {
            SqliteWorkbookStore(database).use { writer ->
                DriverManager.getConnection(writer.jdbcUrl).use { connection ->
                    connection.createStatement().use { statement ->
                        statement.execute("PRAGMA journal_mode = WAL")
                    }
                }
                val sheet = testDocument(TEST_SHEET_1, "Inputs")
                val initial = testWorkbookOf(sheet)
                writer.saveWorkbook(initial)

                val manifestLoaded = CountDownLatch(1)
                val mutationFinished = CountDownLatch(1)
                SqliteWorkbookStore(
                    jdbcUrl = writer.jdbcUrl,
                    aggregateReadCheckpoint = {
                        manifestLoaded.countDown()
                        check(mutationFinished.await(5, TimeUnit.SECONDS))
                    },
                ).use { reader ->
                    val loaded = AtomicReference<WorkbookState>()
                    val failure = AtomicReference<Throwable>()
                    val read = thread {
                        try {
                            loaded.set(reader.loadWorkbook())
                        } catch (exception: Throwable) {
                            failure.set(exception)
                        }
                    }

                    assertTrue(manifestLoaded.await(5, TimeUnit.SECONDS))
                    try {
                        writer.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, 0)) { workbook ->
                            workbook.removeSheet(SheetId(TEST_SHEET_1))
                        }
                    } finally {
                        mutationFinished.countDown()
                    }
                    read.join()

                    assertNull(failure.get())
                    assertEquals(initial, loaded.get())
                    assertTrue(writer.loadWorkbook().sheetsInOrder.isEmpty())
                }
            }
        } finally {
            Files.deleteIfExists(database)
            Files.deleteIfExists(database.resolveSibling("${database.fileName}-wal"))
            Files.deleteIfExists(database.resolveSibling("${database.fileName}-shm"))
        }
    }

    @Test
    fun `normalized persistence round trips complete sheet state and stable grid identities`() =
        withSqliteStore { store ->
            val sheet = testDocument(
                id = TEST_SHEET_1,
                name = "Inputs",
                frame = FrameState(
                    position = WorkspacePosition(12.5, -8.25),
                    size = SheetFrameSize(360.0, 240.0),
                    zIndex = 7,
                ),
                tabular = TabularContent(
                    rowCount = 25,
                    columnCount = 14,
                    cells = mapOf("A1" to "=SUM(B1:B2)\n", "B1" to "4"),
                ),
            )
            val workbook = testWorkbookOf(sheet)

            store.saveWorkbook(workbook)

            assertEquals(workbook, store.loadWorkbook())
            assertEquals(sheet.tabularContent.rows, store.loadSheet(sheet.id)!!.tabularContent.rows)
            assertEquals(sheet.tabularContent.columns, store.loadSheet(sheet.id)!!.tabularContent.columns)
        }

    @Test
    fun `save replaces removed sheet rows`() = withSqliteStore { store ->
        val first = testDocument(TEST_SHEET_1, "Inputs")
        val second = testDocument(TEST_SHEET_2, "Outputs")
        store.saveWorkbook(testWorkbookOf(first, second))

        val renamed = second.rename("Renamed Outputs")
        store.saveWorkbook(testWorkbookOf(renamed))

        assertEquals(listOf(renamed), store.loadWorkbook().sheetsInOrder)
    }

    @Test
    fun `manifest order and revision persist independently from sheet revisions`() = withSqliteStore { store ->
        val first = testDocument(TEST_SHEET_1, "Inputs")
        val second = testDocument(TEST_SHEET_2, "Outputs")
        val manifest = WorkbookManifest(
            revision = 9,
            sheetIds = listOf(second.id, first.id),
        )
        store.saveWorkbook(
            WorkbookState(manifest, mapOf(first.id to first, second.id to second)),
        )

        assertEquals(listOf(second.id, first.id), store.loadManifest().sheetIds)
        assertEquals(9, store.loadManifest().revision)
        val coordinate = first.tabularContent.coordinateAt("A1")!!
        store.writeCells(
            ExpectedSheetRevision(TEST_SHEET_1, 0),
            listOf(CellWrite(coordinate, "42")),
        )
        assertEquals(9, store.loadManifest().revision)
    }
}
