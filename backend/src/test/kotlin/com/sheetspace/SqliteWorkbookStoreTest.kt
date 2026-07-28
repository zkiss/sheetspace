package com.sheetspace

import java.sql.DriverManager
import java.sql.SQLException
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
        assertEquals(emptyWorkbookState(), store.loadWorkbook())
        assertEquals(WORKBOOK_SCHEMA_VERSION, store.loadStoredSchemaVersion())
    }

    @Test
    fun `flat persistence adapter round trips complete sheet document state`() = withStore { store ->
        val sheet = document(
            id = SHEET_1,
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
        val workbook = workbookOf(sheet)

        store.saveWorkbook(workbook)

        assertEquals(workbook, store.loadWorkbook())
    }

    @Test
    fun `save replaces removed sheet rows`() = withStore { store ->
        val first = document(SHEET_1, "Inputs")
        val second = document(SHEET_2, "Outputs")
        store.saveWorkbook(workbookOf(first, second))

        val renamed = second.rename("Renamed Outputs")
        store.saveWorkbook(workbookOf(renamed))

        assertEquals(listOf(renamed), store.loadWorkbook().sheetsInOrder)
    }

    @Test
    fun `non-revision updates serialize concurrent workbook transforms`() = withStore { store ->
        val gate = CountDownLatch(1)
        val workers = listOf(
            document(SHEET_1, "Inputs"),
            document(SHEET_2, "Outputs"),
        ).map { sheet ->
            thread {
                gate.await()
                store.updateWorkbook { workbook ->
                    val nextZIndex = (workbook.documents.values.maxOfOrNull { it.frame.zIndex } ?: 0) + 1
                    workbook.addSheet(
                        sheet.updateFrame { it.update(zIndex = nextZIndex) },
                    )
                }
            }
        }

        gate.countDown()
        workers.forEach { it.join() }

        val sheets = store.loadWorkbook().sheetsInOrder
        assertEquals(setOf(SHEET_1, SHEET_2), sheets.map { it.id.value }.toSet())
        assertEquals(setOf(1, 2), sheets.map { it.frame.zIndex }.toSet())
    }

    @Test
    fun `revisioned update increments once and rejects stale revisions`() = withStore { store ->
        store.saveWorkbook(workbookOf(document(SHEET_1, "Inputs")))
        val updated = store.updateWorkbook(ExpectedSheetRevision(SHEET_1, 0)) { workbook ->
            val sheet = workbook.documents.getValue(SheetId(SHEET_1))
            workbook.replaceSheet(
                sheet.updateTabularContent { it.copy(cells = mapOf("A1" to "newer value")) },
            )
        }

        val conflict = assertFailsWith<SheetRevisionConflict> {
            store.updateWorkbook(ExpectedSheetRevision(SHEET_1, 0)) { workbook ->
                val sheet = workbook.documents.getValue(SheetId(SHEET_1))
                workbook.replaceSheet(
                    sheet.updateTabularContent { it.copy(cells = mapOf("A1" to "stale value")) },
                )
            }
        }

        assertEquals(1, updated.sheetsInOrder.single().revision)
        assertEquals(1, conflict.actualRevision)
        assertEquals(
            "newer value",
            store.loadWorkbook().sheetsInOrder.single().tabularContent.cells.getValue("A1"),
        )
    }

    @Test
    fun `concurrent same revision updates yield one save and one conflict`() = withStore { store ->
        store.saveWorkbook(workbookOf(document(SHEET_1, "Inputs")))
        val gate = CountDownLatch(1)
        val outcomes = Collections.synchronizedList(mutableListOf<String>())
        val workers = listOf("first", "second").map { value ->
            thread {
                gate.await()
                try {
                    store.updateWorkbook(ExpectedSheetRevision(SHEET_1, 0)) { workbook ->
                        val sheet = workbook.documents.getValue(SheetId(SHEET_1))
                        workbook.replaceSheet(
                            sheet.updateTabularContent { it.copy(cells = mapOf("A1" to value)) },
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
        assertEquals(1, store.loadWorkbook().sheetsInOrder.single().revision)
    }

    @Test
    fun `revisioned deletion succeeds once and rejects stale deletion`() = withStore { store ->
        store.saveWorkbook(workbookOf(document(SHEET_1, "Inputs")))
        store.updateWorkbook(ExpectedSheetRevision(SHEET_1, 0)) { workbook ->
            val sheet = workbook.documents.getValue(SheetId(SHEET_1))
            workbook.replaceSheet(
                sheet.updateTabularContent { it.copy(cells = mapOf("A1" to "newer")) },
            )
        }

        val stale = assertFailsWith<SheetRevisionConflict> {
            store.updateWorkbook(ExpectedSheetRevision(SHEET_1, 0)) { workbook ->
                workbook.removeSheet(SheetId(SHEET_1))
            }
        }
        val deleted = store.updateWorkbook(ExpectedSheetRevision(SHEET_1, 1)) { workbook ->
            workbook.removeSheet(SheetId(SHEET_1))
        }

        assertEquals(1, stale.actualRevision)
        assertEquals(emptyWorkbookState(), deleted)
    }

    @Test
    fun `stores UUID ids as blobs and raw formula strings without artifacts`() = withStore { store ->
        val formula = "= \n SuM ( B1 , B2 )"
        store.saveWorkbook(
            workbookOf(
                document(
                    SHEET_1,
                    "Inputs",
                    tabular = TabularContent(cells = mapOf("A1" to formula)),
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

    @Test
    fun `schema rejects malformed and text sheet ids`() = withStore { store ->
        DriverManager.getConnection(store.jdbcUrl).use { connection ->
            connection.createStatement().use { statement ->
                assertFailsWith<SQLException> {
                    statement.executeUpdate(
                        """
                        INSERT INTO sheets (
                            id, name, row_count, column_count, position_x, position_y,
                            cells_json, revision, z_index, frame_width, frame_height
                        ) VALUES (X'00', 'Invalid', 20, 10, 0, 0, '{"cells":{}}', 0, 1, 240, 160)
                        """.trimIndent(),
                    )
                }
                assertFailsWith<SQLException> {
                    statement.executeUpdate(
                        """
                        INSERT INTO sheets (
                            id, name, row_count, column_count, position_x, position_y,
                            cells_json, revision, z_index, frame_width, frame_height
                        ) VALUES ('1234567890123456', 'Invalid Text', 20, 10, 0, 0, '{"cells":{}}', 0, 1, 240, 160)
                        """.trimIndent(),
                    )
                }
            }
        }
    }

    private fun withStore(block: (SqliteWorkbookStore) -> Unit) {
        SqliteWorkbookStore.inMemory().use(block)
    }

    private fun document(
        id: String,
        name: String,
        frame: FrameState = FrameState(),
        tabular: TabularContent = TabularContent(),
    ): SheetDocument = SheetDocument(
        id = SheetId(id),
        name = name,
        frame = frame,
        content = tabular,
    )

    private fun workbookOf(vararg sheets: SheetDocument): WorkbookState = WorkbookState(
        manifest = WorkbookManifest(sheetIds = sheets.map { it.id }),
        documents = sheets.associateBy { it.id },
    )

    private companion object {
        const val SHEET_1 = "00000000-0000-0000-0000-000000000001"
        const val SHEET_2 = "00000000-0000-0000-0000-000000000002"
    }
}
