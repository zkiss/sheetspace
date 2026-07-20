package com.sheetspace

import org.flywaydb.core.Flyway
import java.nio.file.Files
import java.nio.file.Path
import java.sql.DriverManager
import java.sql.SQLException
import java.util.Collections
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith

class WorkbookRepositoryTest {
    @Test
    fun `loads empty workbook when database has no saved state`() {
        val repo = createRepo()

        assertEquals(emptyWorkbook(), repo.loadWorkbook())
    }

    @Test
    fun `persists and reloads workbook state including raw formulas and positions`() {
        val repo = createRepo()
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
                    cells = mapOf(
                        "A1" to "=SUM(B1:B2)\n",
                        "B1" to "4",
                    ),
                ),
            ),
        )

        repo.saveWorkbook(workbook)

        assertEquals(workbook, repo.loadWorkbook())
    }

    @Test
    fun `saves workbook as replaceable sheet rows`() {
        val repo = createRepo()
        val first = Sheet(id = SHEET_1, name = "Inputs")
        val second = Sheet(id = SHEET_2, name = "Outputs")

        repo.saveWorkbook(Workbook(sheets = listOf(first, second)))
        repo.saveWorkbook(Workbook(sheets = listOf(second.copy(name = "Renamed Outputs"))))

        assertEquals(listOf(second.copy(name = "Renamed Outputs")), repo.loadWorkbook().sheets)
    }

    @Test
    fun `supports sheet-level updates and keeps formula display artifacts out of persistence`() {
        val repo = createRepo()

        repo.createSheet(Sheet(id = SHEET_1, name = "Inputs"))
        repo.updateCell(SHEET_1, "A1", "=SUM(B1:B2)")
        repo.updateCell(SHEET_1, "B1", "2")
        repo.updateCell(SHEET_1, "B2", "3")
        repo.renameSheet(SHEET_1, "Renamed Inputs")
        repo.updateSheetPosition(SHEET_1, WorkspacePosition(80.0, 120.0))
        repo.updateSheetFrameSize(SHEET_1, SheetFrameSize(320.0, 220.0))
        repo.updateSheetZIndex(SHEET_1, 4)
        repo.appendRow(SHEET_1)
        repo.appendColumn(SHEET_1)

        val reloaded = repo.loadWorkbook()
        val sheet = reloaded.sheets.single()
        assertEquals("Renamed Inputs", sheet.name)
        assertEquals(21, sheet.rowCount)
        assertEquals(11, sheet.columnCount)
        assertEquals(WorkspacePosition(80.0, 120.0), sheet.position)
        assertEquals(SheetFrameSize(320.0, 220.0), sheet.frameSize)
        assertEquals(4, sheet.zIndex)
        assertEquals("=SUM(B1:B2)", sheet.cells.getValue("A1"))
        assertFalse(sheet.cells.containsKey("A1_display"))
    }

    @Test
    fun `stores canonical formula strings directly and leaves them unchanged after rename`() {
        val dbPath = createDbPath()
        val repo = WorkbookRepository(dbPath)
        repo.createSheet(Sheet(id = SHEET_1, name = "Inputs"))
        repo.createSheet(Sheet(id = SHEET_2, name = "Outputs"))
        val formula = "=SUM($SHEET_1!A1, $SHEET_1!A2)"
        repo.updateCell(SHEET_2, "A1", formula)

        DriverManager.getConnection("jdbc:sqlite:${dbPath.toAbsolutePath()}").use { conn ->
            conn.createStatement().use { statement ->
                statement.executeQuery("SELECT cells_json FROM sheets WHERE name = 'Outputs'").use { rs ->
                    assertTrue(rs.next())
                    val cellsJson = rs.getString(1)
                    assertContains(cellsJson, """"A1":"$formula"""")
                    assertFalse(cellsJson.contains("raw"))
                    assertFalse(cellsJson.contains("sheetReferences"))
                }
            }
        }

        repo.renameSheet(SHEET_1, "Renamed Inputs")

        assertEquals(
            formula,
            repo.loadWorkbook().sheets.single { it.id == SHEET_2 }.cells.getValue("A1"),
        )
    }

    @Test
    fun `keeps canonical formula ids after target deletion`() {
        val repo = createRepo()
        repo.createSheet(Sheet(id = SHEET_1, name = "Inputs"))
        repo.createSheet(Sheet(id = SHEET_2, name = "Outputs"))
        repo.updateCell(SHEET_2, "A1", "=SUM($SHEET_1!A1)")

        repo.deleteSheet(SHEET_1)

        assertEquals(
            "=SUM($SHEET_1!A1)",
            repo.loadWorkbook().sheets.single().cells.getValue("A1"),
        )
    }

    @Test
    fun `leaves malformed and same sheet formulas unchanged during persistence`() {
        val repo = createRepo()
        repo.createSheet(Sheet(id = SHEET_1, name = "Inputs"))
        repo.createSheet(Sheet(id = SHEET_2, name = "Owner's Plan"))
        repo.createSheet(Sheet(id = SHEET_3, name = "foo)"))
        repo.createSheet(Sheet(id = SHEET_4, name = "foo"))
        repo.createSheet(Sheet(id = SHEET_5, name = "foo!bar"))
        repo.updateCell(SHEET_1, "A1", "=SUM(B1)")
        repo.updateCell(SHEET_1, "A2", "=SUM('Inputs!A1)")
        repo.updateCell(SHEET_1, "A3", "=SUM('Owner's Plan'!A1)")
        repo.updateCell(SHEET_1, "A4", "=SUM(foo)!A1)")
        repo.updateCell(SHEET_1, "A5", "=SUM(foo!bar!A1)")

        repo.renameSheet(SHEET_2, "Director's Plan")
        repo.renameSheet(SHEET_3, "Bar")
        repo.renameSheet(SHEET_4, "Baz")
        repo.renameSheet(SHEET_5, "Qux")

        val cells = repo.loadWorkbook().sheets.single { it.id == SHEET_1 }.cells

        assertEquals("=SUM(B1)", cells.getValue("A1"))
        assertEquals("=SUM('Inputs!A1)", cells.getValue("A2"))
        assertEquals("=SUM('Owner's Plan'!A1)", cells.getValue("A3"))
        assertEquals("=SUM(foo)!A1)", cells.getValue("A4"))
        assertEquals("=SUM(foo!bar!A1)", cells.getValue("A5"))
    }

    @Test
    fun `deletes one persisted sheet and rejects unknown sheet ids`() {
        val repo = createRepo()
        val inputs = repo.createSheet(Sheet(id = SHEET_1, name = "Inputs")).sheets.single { it.id == SHEET_1 }
        repo.createSheet(Sheet(id = SHEET_2, name = "Outputs"))

        assertEquals(listOf(SHEET_2), repo.deleteSheet(SHEET_1, inputs.revision).sheets.map { it.id })
        assertFailsWith<UnknownSheetUpdate> {
            repo.deleteSheet(SHEET_1, inputs.revision)
        }
        assertEquals(listOf(SHEET_2), repo.loadWorkbook().sheets.map { it.id })
    }

    @Test
    fun `rejects stale sheet revision updates without overwriting newer persisted data`() {
        val repo = createRepo()

        val created = repo.createSheet(Sheet(id = SHEET_1, name = "Inputs")).sheets.single()
        val afterFirstSave = repo.updateCell(SHEET_1, "A1", "newer value", created.revision)

        val conflict = assertFailsWith<SheetRevisionConflict> {
            repo.updateCell(SHEET_1, "A1", "stale value", created.revision)
        }

        assertEquals(SHEET_1, conflict.sheetId)
        assertEquals(created.revision, conflict.expectedRevision)
        assertEquals(afterFirstSave.sheets.single().revision, conflict.actualRevision)
        val reloaded = repo.loadWorkbook().sheets.single()
        assertEquals("newer value", reloaded.cells.getValue("A1"))
        assertEquals(afterFirstSave.sheets.single().revision, reloaded.revision)
    }

    @Test
    fun `rejects stale sheet deletion without removing newer persisted data`() {
        val repo = createRepo()

        val created = repo.createSheet(Sheet(id = SHEET_1, name = "Inputs")).sheets.single()
        val afterFirstSave = repo.updateCell(SHEET_1, "A1", "newer value", created.revision)

        val conflict = assertFailsWith<SheetRevisionConflict> {
            repo.deleteSheet(SHEET_1, created.revision)
        }

        assertEquals(SHEET_1, conflict.sheetId)
        assertEquals(created.revision, conflict.expectedRevision)
        assertEquals(afterFirstSave.sheets.single().revision, conflict.actualRevision)
        val reloaded = repo.loadWorkbook().sheets.single()
        assertEquals(SHEET_1, reloaded.id)
        assertEquals("newer value", reloaded.cells.getValue("A1"))
    }

    @Test
    fun `rejects invalid sheet renames instead of silently ignoring them`() {
        val repo = createRepo()
        repo.createSheet(Sheet(id = SHEET_1, name = "Inputs"))
        repo.createSheet(Sheet(id = SHEET_2, name = "Outputs"))

        val emptyName = assertFailsWith<SheetNameRejected> {
            repo.renameSheet(SHEET_1, "   ")
        }
        val duplicateName = assertFailsWith<SheetNameRejected> {
            repo.renameSheet(SHEET_1, "Outputs")
        }

        assertEquals(SheetNameError.EMPTY, emptyName.reason)
        assertEquals(SheetNameError.DUPLICATE, duplicateName.reason)
        assertEquals(listOf("Inputs", "Outputs"), repo.loadWorkbook().sheets.map { it.name })
    }

    @Test
    fun `concurrent same revision updates resolve as one save and one conflict`() {
        val repo = createRepo()
        val revision = repo.createSheet(Sheet(id = SHEET_1, name = "Inputs")).sheets.single().revision
        val start = CountDownLatch(1)
        val outcomes = Collections.synchronizedList(mutableListOf<String>())

        val first = thread {
            start.await()
            outcomes += runCatching {
                repo.updateCell(SHEET_1, "A1", "first", revision)
                "saved"
            }.getOrElse { exception ->
                if (exception is SheetRevisionConflict) "conflict" else throw exception
            }
        }
        val second = thread {
            start.await()
            outcomes += runCatching {
                repo.updateCell(SHEET_1, "A1", "second", revision)
                "saved"
            }.getOrElse { exception ->
                if (exception is SheetRevisionConflict) "conflict" else throw exception
            }
        }

        start.countDown()
        first.join()
        second.join()

        assertEquals(listOf("conflict", "saved"), outcomes.sorted())
        val sheet = repo.loadWorkbook().sheets.single()
        assertTrue(sheet.cells.getValue("A1") in setOf("first", "second"))
        assertEquals(revision + 1, sheet.revision)
    }

    @Test
    fun `enforces sheet name trimming and uniqueness for sheet creation`() {
        val repo = createRepo()

        repo.createSheet(Sheet(id = SHEET_1, name = "  Inputs  "))
        val duplicateName = assertFailsWith<SheetNameRejected> {
            repo.createSheet(Sheet(id = SHEET_2, name = "Inputs"))
        }

        assertEquals(SheetNameError.DUPLICATE, duplicateName.reason)
        val workbook = repo.loadWorkbook()
        assertEquals(1, workbook.sheets.size)
        assertEquals("Inputs", workbook.sheets.single().name)
    }

    @Test
    fun `concurrent default z-index sheet creations stack deterministically`() {
        val repo = createRepo()
        val start = CountDownLatch(1)
        val outcomes = Collections.synchronizedList(mutableListOf<Workbook>())

        val first = thread {
            start.await()
            outcomes += repo.createSheet(Sheet(id = SHEET_1, name = "Inputs"), assignDefaultZIndex = true)
        }
        val second = thread {
            start.await()
            outcomes += repo.createSheet(Sheet(id = SHEET_2, name = "Outputs"), assignDefaultZIndex = true)
        }

        start.countDown()
        first.join()
        second.join()

        assertEquals(2, outcomes.size)
        assertEquals(setOf(1, 2), repo.loadWorkbook().sheets.map { it.zIndex }.toSet())
    }

    @Test
    fun `concurrent duplicate sheet creations save one sheet and reject one request`() {
        val repo = createRepo()
        val start = CountDownLatch(1)
        val outcomes = Collections.synchronizedList(mutableListOf<String>())

        val first = thread {
            start.await()
            outcomes += runCatching {
                repo.createSheet(Sheet(id = SHEET_1, name = "Inputs"), assignDefaultZIndex = true)
                "saved"
            }.getOrElse { exception ->
                if (exception is SheetNameRejected) "duplicate" else throw exception
            }
        }
        val second = thread {
            start.await()
            outcomes += runCatching {
                repo.createSheet(Sheet(id = SHEET_2, name = "Inputs"), assignDefaultZIndex = true)
                "saved"
            }.getOrElse { exception ->
                if (exception is SheetNameRejected) "duplicate" else throw exception
            }
        }

        start.countDown()
        first.join()
        second.join()

        assertEquals(listOf("duplicate", "saved"), outcomes.sorted())
        assertEquals(listOf("Inputs"), repo.loadWorkbook().sheets.map { it.name })
    }

    @Test
    fun `stores schema version marker in persistence row`() {
        val repo = createRepo()
        repo.createSheet(Sheet(id = SHEET_1, name = "Inputs"))

        assertEquals(WORKBOOK_SCHEMA_VERSION, repo.loadStoredSchemaVersion())
        assertTrue(repo.loadWorkbook().sheets.isNotEmpty())
    }

    @Test
    fun `stores sheet ids as checked 16 byte blobs`() {
        val dbPath = createDbPath()
        val repo = WorkbookRepository(dbPath)
        repo.createSheet(Sheet(id = SHEET_1, name = "Inputs"))

        DriverManager.getConnection("jdbc:sqlite:${dbPath.toAbsolutePath()}").use { conn ->
            conn.createStatement().use { statement ->
                statement.executeQuery("SELECT typeof(id), length(id) FROM sheets").use { rs ->
                    assertTrue(rs.next())
                    assertEquals("blob", rs.getString(1))
                    assertEquals(16, rs.getInt(2))
                }
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

    @Test
    fun `sheets schema does not expose display order`() {
        val dbPath = createDbPath()
        WorkbookRepository(dbPath)

        DriverManager.getConnection("jdbc:sqlite:${dbPath.toAbsolutePath()}").use { conn ->
            conn.createStatement().use { statement ->
                statement.executeQuery("PRAGMA table_info(sheets)").use { rs ->
                    val columns = buildList {
                        while (rs.next()) {
                            add(rs.getString("name"))
                        }
                    }

                    assertFalse(columns.contains("display_order"))
                }
            }
        }
    }

    @Test
    fun `uuid blob migration explicitly discards legacy sheets`() {
        val dbPath = createDbPath()
        val jdbcUrl = "jdbc:sqlite:${dbPath.toAbsolutePath()}"
        Flyway.configure()
            .dataSource(jdbcUrl, null, null)
            .locations("classpath:db/migration")
            .target("3")
            .load()
            .migrate()
        DriverManager.getConnection(jdbcUrl).use { conn ->
            conn.createStatement().use { statement ->
                statement.executeUpdate(
                    """
                    INSERT INTO sheets (
                        id, display_order, name, row_count, column_count, position_x, position_y,
                        cells_json, revision, z_index, frame_width, frame_height
                    ) VALUES ('legacy-sheet', 0, 'Legacy', 20, 10, 0, 0, '{"cells":{}}', 0, 1, 240, 160)
                    """.trimIndent(),
                )
            }
        }

        assertEquals(emptyWorkbook(), WorkbookRepository(dbPath).loadWorkbook())
    }

    @Test
    fun `string cell migration explicitly discards existing sheets`() {
        val dbPath = createDbPath()
        val jdbcUrl = "jdbc:sqlite:${dbPath.toAbsolutePath()}"
        Flyway.configure()
            .dataSource(jdbcUrl, null, null)
            .locations("classpath:db/migration")
            .target("6")
            .load()
            .migrate()
        DriverManager.getConnection(jdbcUrl).use { conn ->
            conn.createStatement().use { statement ->
                statement.executeUpdate(
                    """
                    INSERT INTO sheets (
                        id, name, row_count, column_count, position_x, position_y,
                        cells_json, revision, z_index, frame_width, frame_height
                    ) VALUES (X'00000000000000000000000000000001', 'Inputs', 25, 14, 12.5, -8.25, '{"cells":{"A1":{"raw":"7"}}}', 3, 9, 360, 240)
                    """.trimIndent(),
                )
            }
        }

        assertEquals(emptyWorkbook(), WorkbookRepository(dbPath).loadWorkbook())
    }

    @Test
    fun `formula reference migration explicitly discards sheets with legacy cell json`() {
        val dbPath = createDbPath()
        val jdbcUrl = "jdbc:sqlite:${dbPath.toAbsolutePath()}"
        Flyway.configure()
            .dataSource(jdbcUrl, null, null)
            .locations("classpath:db/migration")
            .target("4")
            .load()
            .migrate()
        DriverManager.getConnection(jdbcUrl).use { conn ->
            conn.createStatement().use { statement ->
                statement.executeUpdate(
                    """
                    INSERT INTO sheets (
                        id, display_order, name, row_count, column_count, position_x, position_y,
                        cells_json, revision, z_index, frame_width, frame_height
                    ) VALUES (X'00000000000000000000000000000001', 0, 'Legacy', 20, 10, 0, 0, '{"cells":{}}', 0, 1, 240, 160)
                    """.trimIndent(),
                )
            }
        }

        assertEquals(emptyWorkbook(), WorkbookRepository(dbPath).loadWorkbook())
    }

    private fun createRepo(): WorkbookRepository {
        return WorkbookRepository(createDbPath())
    }

    private fun createDbPath(): Path {
        return Files.createTempFile("sheetspace-workbook", ".sqlite")
    }

    private companion object {
        const val SHEET_1 = "00000000-0000-0000-0000-000000000001"
        const val SHEET_2 = "00000000-0000-0000-0000-000000000002"
        const val SHEET_3 = "00000000-0000-0000-0000-000000000003"
        const val SHEET_4 = "00000000-0000-0000-0000-000000000004"
        const val SHEET_5 = "00000000-0000-0000-0000-000000000005"
    }
}
