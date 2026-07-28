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
    fun `normalized persistence round trips complete sheet state and stable grid identities`() = withStore { store ->
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
        assertEquals(sheet.tabularContent.rows, store.loadSheet(sheet.id)!!.tabularContent.rows)
        assertEquals(sheet.tabularContent.columns, store.loadSheet(sheet.id)!!.tabularContent.columns)
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
        assertEquals(emptyList(), deleted.sheetsInOrder)
        assertEquals(1, deleted.manifest.revision)
    }

    @Test
    fun `stores UUID ids as blobs and raw formula strings in sparse cell rows`() = withStore { store ->
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
    fun `schema separates manifest documents frames structure and cells`() = withStore { store ->
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
    fun `schema rejects malformed and text sheet ids`() = withStore { store ->
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
    fun `schema enforces grid order and same-sheet cell ownership`() = withStore { store ->
        val first = document(SHEET_1, "Inputs")
        val second = document(SHEET_2, "Outputs")
        store.saveWorkbook(workbookOf(first, second))

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

    @Test
    fun `prepared batch cell write changes one sheet revision and leaves manifest untouched`() = withStore { store ->
        val first = document(SHEET_1, "Inputs")
        val second = document(SHEET_2, "Outputs")
        store.saveWorkbook(workbookOf(first, second))
        val firstContent = first.tabularContent

        val updated = store.writeCells(
            ExpectedSheetRevision(SHEET_1, 0),
            listOf(
                CellWrite(firstContent.coordinateAt("A1")!!, "raw"),
                CellWrite(firstContent.coordinateAt("B2")!!, "=A1"),
            ),
        )

        assertEquals(mapOf("A1" to "raw", "B2" to "=A1"), updated.tabularContent.cells)
        assertEquals(1, updated.revision)
        assertEquals(0, store.loadSheet(SheetId(SHEET_2))!!.revision)
        assertEquals(0, store.loadManifest().revision)
    }

    @Test
    fun `stale batch cell write is atomic`() = withStore { store ->
        val sheet = document(SHEET_1, "Inputs")
        store.saveWorkbook(workbookOf(sheet))
        val coordinate = sheet.tabularContent.coordinateAt("A1")!!
        store.writeCells(
            ExpectedSheetRevision(SHEET_1, 0),
            listOf(CellWrite(coordinate, "newer")),
        )

        assertFailsWith<SheetRevisionConflict> {
            store.writeCells(
                ExpectedSheetRevision(SHEET_1, 0),
                listOf(CellWrite(coordinate, "stale")),
            )
        }

        assertEquals("newer", store.loadSheet(SheetId(SHEET_1))!!.tabularContent.cells.getValue("A1"))
    }

    @Test
    fun `manifest order and revision persist independently from sheet revisions`() = withStore { store ->
        val first = document(SHEET_1, "Inputs")
        val second = document(SHEET_2, "Outputs")
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
            ExpectedSheetRevision(SHEET_1, 0),
            listOf(CellWrite(coordinate, "42")),
        )
        assertEquals(9, store.loadManifest().revision)
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

private fun String.toTestUuidBytes(): ByteArray {
    val uuid = java.util.UUID.fromString(this)
    return java.nio.ByteBuffer.allocate(16)
        .putLong(uuid.mostSignificantBits)
        .putLong(uuid.leastSignificantBits)
        .array()
}
