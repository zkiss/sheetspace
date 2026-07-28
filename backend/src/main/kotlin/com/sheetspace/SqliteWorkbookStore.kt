package com.sheetspace

import org.flywaydb.core.Flyway
import java.nio.ByteBuffer
import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import java.util.UUID

class SqliteWorkbookStore internal constructor(
    internal val jdbcUrl: String,
    private val keepAliveConnection: Connection? = null,
) : WorkbookStore, AutoCloseable {
    private val updateLock = Any()

    constructor(dbPath: Path) : this("jdbc:sqlite:${dbPath.toAbsolutePath()}")

    init {
        initialize()
    }

    override fun close() {
        keepAliveConnection?.close()
    }

    override fun loadManifest(): WorkbookManifest = connection(::loadManifest)

    override fun loadSheet(sheetId: SheetId): SheetDocument? =
        connection { conn -> loadSheet(conn, sheetId) }

    override fun loadWorkbook(): WorkbookState = connection(::loadWorkbook)

    override fun saveWorkbook(workbook: WorkbookState) {
        require(workbook.manifest.version == WORKBOOK_SCHEMA_VERSION) {
            "Unsupported workbook version: ${workbook.manifest.version}"
        }
        synchronized(updateLock) {
            connection { conn ->
                transaction(conn) {
                    conn.createStatement().use { it.executeUpdate("DELETE FROM sheet_documents") }
                    workbook.sheetsInOrder.forEach { insertSheet(conn, it) }
                    replaceManifest(conn, workbook.manifest)
                }
            }
        }
    }

    override fun writeCells(
        expectedRevision: ExpectedSheetRevision,
        writes: List<CellWrite>,
    ): SheetDocument {
        require(writes.isNotEmpty()) { "At least one cell write is required" }
        require(writes.map(CellWrite::coordinate).distinct().size == writes.size) {
            "Cell writes must target distinct coordinates"
        }
        return synchronized(updateLock) {
            connection { conn ->
                transaction(conn) {
                    val sheetId = SheetId(expectedRevision.sheetId)
                    val current = loadSheet(conn, sheetId)
                        ?: throw NoSuchElementException("Sheet not found: ${sheetId.value}")
                    if (current.revision != expectedRevision.revision) {
                        throw SheetRevisionConflict(
                            sheetId.value,
                            expectedRevision.revision,
                            current.revision,
                        )
                    }

                    incrementSheetRevision(conn, sheetId, expectedRevision.revision)
                    applyCellWrites(conn, sheetId, writes)
                    loadSheet(conn, sheetId) ?: error("Updated sheet disappeared: ${sheetId.value}")
                }
            }
        }
    }

    override fun updateWorkbook(
        expectedRevision: ExpectedSheetRevision?,
        transform: (WorkbookState) -> WorkbookState,
    ): WorkbookState = synchronized(updateLock) {
        connection { conn ->
            transaction(conn) {
                val current = loadWorkbook(conn)
                val updated = transform(current)
                if (expectedRevision != null) {
                    val currentSheet = current.findSheet(SheetId(expectedRevision.sheetId))
                    if (currentSheet != null && currentSheet.revision != expectedRevision.revision) {
                        throw SheetRevisionConflict(
                            expectedRevision.sheetId,
                            expectedRevision.revision,
                            currentSheet.revision,
                        )
                    }
                }

                persistChanges(conn, current, updated)
                loadWorkbook(conn)
            }
        }
    }

    internal fun loadStoredSchemaVersion(): Int? = connection { conn ->
        conn.prepareStatement("SELECT schema_version FROM workbook_metadata WHERE singleton_key = 1")
            .use { statement ->
                statement.executeQuery().use { rs ->
                    if (rs.next()) rs.getInt("schema_version") else null
                }
            }
    }

    private fun initialize() {
        Flyway.configure()
            .dataSource(jdbcUrl, null, null)
            .locations("classpath:db/migration")
            .load()
            .migrate()
    }

    private fun loadWorkbook(conn: Connection): WorkbookState {
        val manifest = loadManifest(conn)
        val documents = manifest.sheetIds.associateWith { sheetId ->
            loadSheet(conn, sheetId) ?: error("Manifest references missing sheet: ${sheetId.value}")
        }
        return WorkbookState(manifest, documents)
    }

    private fun loadManifest(conn: Connection): WorkbookManifest {
        val metadata = conn.prepareStatement(
            "SELECT schema_version, manifest_revision FROM workbook_metadata WHERE singleton_key = 1",
        ).use { statement ->
            statement.executeQuery().use { rs ->
                check(rs.next()) { "Workbook metadata is missing" }
                rs.getInt("schema_version") to rs.getLong("manifest_revision")
            }
        }
        val sheetIds = conn.prepareStatement(
            "SELECT sheet_id FROM workbook_sheets ORDER BY sheet_order",
        ).use { statement ->
            statement.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) add(SheetId(rs.getBytes("sheet_id").toUuidString()))
                }
            }
        }
        return WorkbookManifest(
            version = metadata.first,
            revision = metadata.second,
            sheetIds = sheetIds,
        )
    }

    private fun loadSheet(conn: Connection, sheetId: SheetId): SheetDocument? {
        val document = conn.prepareStatement(
            """
            SELECT d.id, d.name, d.revision,
                   f.position_x, f.position_y, f.frame_width, f.frame_height, f.z_index
            FROM sheet_documents d
            JOIN frame_state f ON f.sheet_id = d.id
            WHERE d.id = ?
            """.trimIndent(),
        ).use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.executeQuery().use { rs ->
                if (!rs.next()) return null
                SheetRecord(
                    id = SheetId(rs.getBytes("id").toUuidString()),
                    name = rs.getString("name"),
                    revision = rs.getLong("revision"),
                    frame = FrameState(
                        position = WorkspacePosition(
                            rs.getDouble("position_x"),
                            rs.getDouble("position_y"),
                        ),
                        size = SheetFrameSize(
                            rs.getDouble("frame_width"),
                            rs.getDouble("frame_height"),
                        ),
                        zIndex = rs.getInt("z_index"),
                    ),
                )
            }
        }
        val rows = loadRows(conn, sheetId)
        val columns = loadColumns(conn, sheetId)
        val cells = loadCells(conn, sheetId)
        return SheetDocument(
            id = document.id,
            name = document.name,
            revision = document.revision,
            frame = document.frame,
            content = TabularContent(rows, columns, cells),
        )
    }

    private fun loadRows(conn: Connection, sheetId: SheetId): List<RowId> =
        conn.prepareStatement(
            "SELECT row_id FROM sheet_rows WHERE sheet_id = ? ORDER BY row_order",
        ).use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) add(RowId(rs.getBytes("row_id").toUuidString()))
                }
            }
        }

    private fun loadColumns(conn: Connection, sheetId: SheetId): List<ColumnId> =
        conn.prepareStatement(
            "SELECT column_id FROM sheet_columns WHERE sheet_id = ? ORDER BY column_order",
        ).use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) add(ColumnId(rs.getBytes("column_id").toUuidString()))
                }
            }
        }

    private fun loadCells(
        conn: Connection,
        sheetId: SheetId,
    ): Map<CellCoordinate, String> =
        conn.prepareStatement(
            "SELECT row_id, column_id, raw_content FROM cells WHERE sheet_id = ?",
        ).use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.executeQuery().use { rs ->
                buildMap {
                    while (rs.next()) {
                        put(
                            CellCoordinate(
                                RowId(rs.getBytes("row_id").toUuidString()),
                                ColumnId(rs.getBytes("column_id").toUuidString()),
                            ),
                            rs.getString("raw_content"),
                        )
                    }
                }
            }
        }

    private fun persistChanges(
        conn: Connection,
        current: WorkbookState,
        updated: WorkbookState,
    ) {
        current.documents.keys
            .filterNot(updated.documents::containsKey)
            .forEach { deleteSheet(conn, it) }

        updated.sheetsInOrder.forEach { updatedSheet ->
            val currentSheet = current.findSheet(updatedSheet.id)
            when {
                currentSheet == null -> insertSheet(conn, updatedSheet)
                currentSheet != updatedSheet -> replaceSheet(conn, currentSheet, updatedSheet)
            }
        }

        if (current.manifest != updated.manifest) {
            replaceManifest(conn, updated.manifest)
        }
    }

    private fun insertSheet(conn: Connection, sheet: SheetDocument) {
        conn.prepareStatement(
            "INSERT INTO sheet_documents (id, name, content_kind, revision) VALUES (?, ?, 'TABULAR', ?)",
        ).use { statement ->
            statement.setBytes(1, sheet.id.value.toUuidBytes())
            statement.setString(2, sheet.name)
            statement.setLong(3, sheet.revision)
            statement.executeUpdate()
        }
        insertFrame(conn, sheet)
        insertTabularContent(conn, sheet.id, sheet.tabularContent)
    }

    private fun replaceSheet(
        conn: Connection,
        current: SheetDocument,
        updated: SheetDocument,
    ) {
        val updatedRows = conn.prepareStatement(
            """
            UPDATE sheet_documents
            SET name = ?, content_kind = 'TABULAR', revision = revision + 1
            WHERE id = ? AND revision = ?
            """.trimIndent(),
        ).use { statement ->
            statement.setString(1, updated.name)
            statement.setBytes(2, updated.id.value.toUuidBytes())
            statement.setLong(3, current.revision)
            statement.executeUpdate()
        }
        if (updatedRows == 0) {
            throw SheetRevisionConflict(
                updated.id.value,
                current.revision,
                loadSheetRevision(conn, updated.id) ?: -1,
            )
        }

        conn.prepareStatement(
            """
            UPDATE frame_state
            SET position_x = ?, position_y = ?, frame_width = ?, frame_height = ?, z_index = ?
            WHERE sheet_id = ?
            """.trimIndent(),
        ).use { statement ->
            statement.setDouble(1, updated.frame.position.x)
            statement.setDouble(2, updated.frame.position.y)
            statement.setDouble(3, updated.frame.size.width)
            statement.setDouble(4, updated.frame.size.height)
            statement.setInt(5, updated.frame.zIndex)
            statement.setBytes(6, updated.id.value.toUuidBytes())
            statement.executeUpdate()
        }
        conn.prepareStatement("DELETE FROM sheet_rows WHERE sheet_id = ?").use { statement ->
            statement.setBytes(1, updated.id.value.toUuidBytes())
            statement.executeUpdate()
        }
        conn.prepareStatement("DELETE FROM sheet_columns WHERE sheet_id = ?").use { statement ->
            statement.setBytes(1, updated.id.value.toUuidBytes())
            statement.executeUpdate()
        }
        insertTabularContent(conn, updated.id, updated.tabularContent)
    }

    private fun insertFrame(conn: Connection, sheet: SheetDocument) {
        conn.prepareStatement(
            """
            INSERT INTO frame_state (
                sheet_id, position_x, position_y, frame_width, frame_height, z_index
            ) VALUES (?, ?, ?, ?, ?, ?)
            """.trimIndent(),
        ).use { statement ->
            statement.setBytes(1, sheet.id.value.toUuidBytes())
            statement.setDouble(2, sheet.frame.position.x)
            statement.setDouble(3, sheet.frame.position.y)
            statement.setDouble(4, sheet.frame.size.width)
            statement.setDouble(5, sheet.frame.size.height)
            statement.setInt(6, sheet.frame.zIndex)
            statement.executeUpdate()
        }
    }

    private fun insertTabularContent(
        conn: Connection,
        sheetId: SheetId,
        content: TabularContent,
    ) {
        conn.prepareStatement(
            "INSERT INTO sheet_rows (sheet_id, row_id, row_order) VALUES (?, ?, ?)",
        ).use { statement ->
            content.rows.forEachIndexed { index, rowId ->
                statement.setBytes(1, sheetId.value.toUuidBytes())
                statement.setBytes(2, rowId.value.toUuidBytes())
                statement.setInt(3, index)
                statement.addBatch()
            }
            statement.executeBatch()
        }
        conn.prepareStatement(
            "INSERT INTO sheet_columns (sheet_id, column_id, column_order) VALUES (?, ?, ?)",
        ).use { statement ->
            content.columns.forEachIndexed { index, columnId ->
                statement.setBytes(1, sheetId.value.toUuidBytes())
                statement.setBytes(2, columnId.value.toUuidBytes())
                statement.setInt(3, index)
                statement.addBatch()
            }
            statement.executeBatch()
        }
        applyCellWrites(
            conn,
            sheetId,
            content.cellContents.map { (coordinate, raw) -> CellWrite(coordinate, raw) },
        )
    }

    private fun applyCellWrites(
        conn: Connection,
        sheetId: SheetId,
        writes: List<CellWrite>,
    ) {
        conn.prepareStatement(
            "DELETE FROM cells WHERE sheet_id = ? AND row_id = ? AND column_id = ?",
        ).use { statement ->
            writes.filter { it.content.isEmpty() }.forEach { write ->
                statement.bindCell(sheetId, write.coordinate)
                statement.addBatch()
            }
            statement.executeBatch()
        }
        conn.prepareStatement(
            """
            INSERT INTO cells (sheet_id, row_id, column_id, raw_content)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(sheet_id, row_id, column_id)
            DO UPDATE SET raw_content = excluded.raw_content
            """.trimIndent(),
        ).use { statement ->
            writes.filterNot { it.content.isEmpty() }.forEach { write ->
                statement.bindCell(sheetId, write.coordinate)
                statement.setString(4, write.content)
                statement.addBatch()
            }
            statement.executeBatch()
        }
    }

    private fun java.sql.PreparedStatement.bindCell(
        sheetId: SheetId,
        coordinate: CellCoordinate,
    ) {
        setBytes(1, sheetId.value.toUuidBytes())
        setBytes(2, coordinate.rowId.value.toUuidBytes())
        setBytes(3, coordinate.columnId.value.toUuidBytes())
    }

    private fun incrementSheetRevision(
        conn: Connection,
        sheetId: SheetId,
        expectedRevision: Long,
    ) {
        val updatedRows = conn.prepareStatement(
            "UPDATE sheet_documents SET revision = revision + 1 WHERE id = ? AND revision = ?",
        ).use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.setLong(2, expectedRevision)
            statement.executeUpdate()
        }
        if (updatedRows == 0) {
            throw SheetRevisionConflict(
                sheetId.value,
                expectedRevision,
                loadSheetRevision(conn, sheetId) ?: -1,
            )
        }
    }

    private fun loadSheetRevision(conn: Connection, sheetId: SheetId): Long? =
        conn.prepareStatement("SELECT revision FROM sheet_documents WHERE id = ?").use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.executeQuery().use { rs ->
                if (rs.next()) rs.getLong("revision") else null
            }
        }

    private fun deleteSheet(conn: Connection, sheetId: SheetId) {
        conn.prepareStatement("DELETE FROM sheet_documents WHERE id = ?").use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.executeUpdate()
        }
    }

    private fun replaceManifest(conn: Connection, manifest: WorkbookManifest) {
        conn.prepareStatement(
            """
            UPDATE workbook_metadata
            SET schema_version = ?, manifest_revision = ?
            WHERE singleton_key = 1
            """.trimIndent(),
        ).use { statement ->
            statement.setInt(1, manifest.version)
            statement.setLong(2, manifest.revision)
            statement.executeUpdate()
        }
        conn.createStatement().use { it.executeUpdate("DELETE FROM workbook_sheets") }
        conn.prepareStatement(
            "INSERT INTO workbook_sheets (sheet_id, sheet_order) VALUES (?, ?)",
        ).use { statement ->
            manifest.sheetIds.forEachIndexed { index, sheetId ->
                statement.setBytes(1, sheetId.value.toUuidBytes())
                statement.setInt(2, index)
                statement.addBatch()
            }
            statement.executeBatch()
        }
    }

    private fun <T> transaction(conn: Connection, block: () -> T): T {
        conn.autoCommit = false
        try {
            val result = block()
            conn.commit()
            return result
        } catch (exception: Exception) {
            conn.rollback()
            throw exception
        } finally {
            conn.autoCommit = true
        }
    }

    private fun <T> connection(block: (Connection) -> T): T {
        DriverManager.getConnection(jdbcUrl).use { conn ->
            conn.createStatement().use {
                it.execute("PRAGMA foreign_keys = ON")
                it.execute("PRAGMA busy_timeout = 5000")
            }
            return block(conn)
        }
    }

    companion object {
        internal fun inMemory(): SqliteWorkbookStore {
            val jdbcUrl = "jdbc:sqlite:file:sheetspace-${UUID.randomUUID()}?mode=memory&cache=shared"
            return SqliteWorkbookStore(jdbcUrl, DriverManager.getConnection(jdbcUrl))
        }
    }
}

private data class SheetRecord(
    val id: SheetId,
    val name: String,
    val revision: Long,
    val frame: FrameState,
)

private fun String.toUuidBytes(): ByteArray {
    val uuid = UUID.fromString(this)
    return ByteBuffer.allocate(16)
        .putLong(uuid.mostSignificantBits)
        .putLong(uuid.leastSignificantBits)
        .array()
}

private fun ByteArray.toUuidString(): String {
    require(size == 16) { "Stored id must be exactly 16 bytes" }
    val bytes = ByteBuffer.wrap(this)
    return UUID(bytes.long, bytes.long).toString()
}
