package com.sheetspace

import java.sql.DriverManager
import java.util.Collections
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SqliteWorkbookStoreTest {
    @Test
    fun `loads an empty workbook from an isolated in-memory database`() = withStore { store ->
        assertEquals(emptyWorkbook(), store.loadWorkbook())
        assertEquals(WORKBOOK_SCHEMA_VERSION, store.loadStoredSchemaVersion())
    }

    @Test
    fun `round trips complete raw workbook state`() = withStore { store ->
        val workbook = Workbook(
            sheets = listOf(
                Sheet(
                    id = SHEET_1,
                    name = "Inputs",
                    position = WorkspacePosition(12.5, -8.25),
                    frameSize = SheetFrameSize(360.0, 240.0),
                    zIndex = 7,
                    rowCount = 25,
                    columnCount = 14,
                    cells = mapOf("A1" to "=SUM(B1:B2)\n", "B1" to "4"),
                ),
            ),
        )

        store.saveWorkbook(workbook)

        assertEquals(workbook, store.loadWorkbook())
    }

    @Test
    fun `save replaces removed sheet rows`() = withStore { store ->
        val first = Sheet(id = SHEET_1, name = "Inputs")
        val second = Sheet(id = SHEET_2, name = "Outputs")
        store.saveWorkbook(Workbook(sheets = listOf(first, second)))

        store.saveWorkbook(Workbook(sheets = listOf(second.copy(name = "Renamed Outputs"))))

        assertEquals(listOf(second.copy(name = "Renamed Outputs")), store.loadWorkbook().sheets)
    }

    @Test
    fun `revisioned update increments once and rejects stale revisions`() = withStore { store ->
        store.saveWorkbook(Workbook(sheets = listOf(Sheet(id = SHEET_1, name = "Inputs"))))
        val updated = store.updateWorkbook(ExpectedSheetRevision(SHEET_1, 0)) { workbook ->
            workbook.copy(
                sheets = workbook.sheets.map { it.copy(cells = mapOf("A1" to "newer value")) },
            )
        }

        val conflict = assertFailsWith<SheetRevisionConflict> {
            store.updateWorkbook(ExpectedSheetRevision(SHEET_1, 0)) { workbook ->
                workbook.copy(
                    sheets = workbook.sheets.map { it.copy(cells = mapOf("A1" to "stale value")) },
                )
            }
        }

        assertEquals(1, updated.sheets.single().revision)
        assertEquals(1, conflict.actualRevision)
        assertEquals("newer value", store.loadWorkbook().sheets.single().cells.getValue("A1"))
    }

    @Test
    fun `concurrent same revision updates yield one save and one conflict`() = withStore { store ->
        store.saveWorkbook(Workbook(sheets = listOf(Sheet(id = SHEET_1, name = "Inputs"))))
        val gate = CountDownLatch(1)
        val outcomes = Collections.synchronizedList(mutableListOf<String>())
        val workers = listOf("first", "second").map { value ->
            thread {
                gate.await()
                try {
                    store.updateWorkbook(ExpectedSheetRevision(SHEET_1, 0)) { workbook ->
                        workbook.copy(
                            sheets = workbook.sheets.map { it.copy(cells = mapOf("A1" to value)) },
                        )
                    }
                    outcomes += "saved"
                } catch (_: SheetRevisionConflict) {
                    outcomes += "conflict"
                }
            }
        }

        gate.countDown()
        workers.forEach { it.join() }

        assertEquals(listOf("conflict", "saved"), outcomes.sorted())
        assertEquals(1, store.loadWorkbook().sheets.single().revision)
    }

    @Test
    fun `stores UUID ids as blobs and raw formula strings without artifacts`() = withStore { store ->
        val formula = "= \n SuM ( B1 , B2 )"
        store.saveWorkbook(
            Workbook(
                sheets = listOf(
                    Sheet(id = SHEET_1, name = "Inputs", cells = mapOf("A1" to formula)),
                ),
            ),
        )

        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            connection.createStatement().use { statement ->
                statement.executeQuery("SELECT id, cells_json FROM sheets").use { result ->
                    assertTrue(result.next())
                    assertEquals(16, result.getBytes("id").size)
                    val cellsJson = result.getString("cells_json")
                    assertContains(cellsJson, "\"A1\"")
                    assertContains(cellsJson, "SuM")
                    assertFalse(cellsJson.contains("display"))
                    assertFalse(cellsJson.contains("sheetReferences"))
                }
            }
        }
    }

    @Test
    fun `schema omits obsolete display order`() = withStore { store ->
        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            val columns = buildSet {
                connection.createStatement().use { statement ->
                    statement.executeQuery("PRAGMA table_info(sheets)").use { result ->
                        while (result.next()) add(result.getString("name"))
                    }
                }
            }
            assertFalse("display_order" in columns)
            assertTrue("z_index" in columns)
            assertTrue("frame_width" in columns)
            assertTrue("frame_height" in columns)
        }
    }

    private fun withStore(block: (SqliteWorkbookStore) -> Unit) {
        SqliteWorkbookStore.inMemory().use(block)
    }

    private companion object {
        const val SHEET_1 = "00000000-0000-0000-0000-000000000001"
        const val SHEET_2 = "00000000-0000-0000-0000-000000000002"
    }
}
