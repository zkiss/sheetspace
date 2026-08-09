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
    fun `targeted read queries and decodes only the requested sheet aggregate`() {
        val readEvents = mutableListOf<SheetReadEvent>()
        SqliteWorkbookStore.inMemory(readEvents::add).use { store ->
            val documents = mediumDocuments(6)
            store.saveWorkbook(testWorkbookOf(*documents.toTypedArray()))
            val target = documents[3]

            readEvents.clear()
            assertEquals(target, store.loadSheet(target.id))

            assertEquals(
                mapOf(
                    SheetReadPart.DOCUMENT to 1,
                    SheetReadPart.ROW to DEFAULT_ROW_COUNT,
                    SheetReadPart.COLUMN to DEFAULT_COLUMN_COUNT,
                    SheetReadPart.CELL to DEFAULT_ROW_COUNT * DEFAULT_COLUMN_COUNT,
                ),
                readEvents.groupingBy { it.part }.eachCount(),
            )
            assertTrue(readEvents.all { it.requestedSheetId == target.id })
            assertTrue(readEvents.all { it.returnedSheetId == target.id })
        }
    }

    @Test
    fun `medium bundle decodes populated sheet data once in linear work`() {
        val readEvents = mutableListOf<SheetReadEvent>()
        SqliteWorkbookStore.inMemory(readEvents::add).use { store ->
            val documents = mediumDocuments(25)
            store.saveWorkbook(testWorkbookOf(*documents.toTypedArray()))

            readEvents.clear()
            assertEquals(documents, store.loadWorkbookBundle().sheetsInOrder)

            val eventsPerSheet = 1 + DEFAULT_ROW_COUNT + DEFAULT_COLUMN_COUNT +
                DEFAULT_ROW_COUNT * DEFAULT_COLUMN_COUNT
            assertEquals(documents.size * eventsPerSheet, readEvents.size)
            assertEquals(
                documents.associate { it.id to eventsPerSheet },
                readEvents.groupingBy { it.requestedSheetId }.eachCount(),
            )
            assertTrue(readEvents.all { it.requestedSheetId == it.returnedSheetId })
        }
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
                            loaded.set(reader.loadWorkbookBundle())
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
                    assertTrue(writer.loadWorkbookBundle().sheetsInOrder.isEmpty())
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

            assertEquals(workbook, store.loadWorkbookBundle())
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

        assertEquals(listOf(renamed), store.loadWorkbookBundle().sheetsInOrder)
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

private fun mediumDocuments(count: Int): List<SheetDocument> {
    val populatedCells = (1..DEFAULT_ROW_COUNT).flatMap { row ->
        (0 until DEFAULT_COLUMN_COUNT).map { column ->
            "${'A' + column}$row" to "$row:$column"
        }
    }.toMap()
    return (1..count).map { index ->
        testDocument(
            id = "00000000-0000-4000-8000-${index.toString().padStart(12, '0')}",
            name = "Sheet $index",
            tabular = TabularContent(cells = populatedCells),
        )
    }
}
