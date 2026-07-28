package com.sheetspace

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.flywaydb.core.Flyway
import java.nio.ByteBuffer
import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import java.sql.ResultSet
import java.util.UUID

class SqliteWorkbookStore internal constructor(
    internal val jdbcUrl: String,
    private val keepAliveConnection: Connection? = null,
) : WorkbookStore, AutoCloseable {
    private val json = Json { ignoreUnknownKeys = false }
    private val updateLock = Any()

    constructor(dbPath: Path) : this("jdbc:sqlite:${dbPath.toAbsolutePath()}")

    init {
        initialize()
    }

    override fun close() {
        keepAliveConnection?.close()
    }

    override fun loadWorkbook(): WorkbookState = connection { conn -> loadWorkbook(conn) }

    override fun saveWorkbook(workbook: WorkbookState) {
        require(workbook.manifest.version == WORKBOOK_SCHEMA_VERSION) {
            "Unsupported workbook version: ${workbook.manifest.version}"
        }
        connection { conn ->
            transaction(conn) {
                conn.createStatement().use { it.executeUpdate("DELETE FROM sheets") }
                workbook.sheetsInOrder.forEach { sheet ->
                    upsertSheet(conn, sheet)
                }
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

    override fun updateWorkbook(
        expectedRevision: ExpectedSheetRevision?,
        transform: (WorkbookState) -> WorkbookState,
    ): WorkbookState = synchronized(updateLock) {
        connection { conn ->
            if (expectedRevision != null) {
                val current = loadWorkbook(conn)
                val sheetId = SheetId(expectedRevision.sheetId)
                val currentSheet = current.findSheet(sheetId)
                val updated = transform(current)

                if (currentSheet != null && currentSheet.revision != expectedRevision.revision) {
                    throw SheetRevisionConflict(
                        expectedRevision.sheetId,
                        expectedRevision.revision,
                        currentSheet.revision,
                    )
                }

                val updatedSheet = updated.findSheet(sheetId)
                if (
                    currentSheet != null &&
                    updatedSheet != null &&
                    currentSheet != updatedSheet
                ) {
                    updateSheetWithExpectedRevision(conn, updatedSheet, expectedRevision.revision)
                }
                if (currentSheet != null && updatedSheet == null) {
                    deleteSheetWithExpectedRevision(
                        conn,
                        expectedRevision.sheetId,
                        expectedRevision.revision,
                    )
                }

                return@connection loadWorkbook(conn)
            }

            transaction(conn) {
                val current = loadWorkbook(conn)
                val updated = transform(current)
                saveChangedSheets(conn, current, updated)
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

    private fun loadWorkbook(conn: Connection): WorkbookState {
        val sheets = conn.prepareStatement(
            """
            SELECT id, name, row_count, column_count, position_x, position_y, frame_width, frame_height, z_index, cells_json, revision
            FROM sheets
            ORDER BY hex(id) ASC
            """.trimIndent(),
        ).use { statement ->
            statement.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) {
                        add(LegacyFlatSheetPersistenceAdapter.toDocument(rs.toLegacyFlatSheetRecord()))
                    }
                }
            }
        }

        // Current schema has no manifest row or membership order. UUID order is the
        // compatibility behavior until sheetspace-z5q.6 normalizes persistence.
        return WorkbookState(
            manifest = WorkbookManifest(sheetIds = sheets.map { it.id }),
            documents = sheets.associateBy { it.id },
        )
    }

    private fun saveChangedSheets(conn: Connection, current: WorkbookState, updated: WorkbookState) {
        val updatedById = updated.documents
        val currentById = current.documents

        for (sheet in current.sheetsInOrder) {
            if (sheet.id !in updatedById) {
                deleteSheet(conn, sheet.id.value)
            }
        }

        updated.sheetsInOrder.forEach { sheet ->
            if (currentById[sheet.id] != sheet) {
                upsertSheet(conn, sheet)
            }
        }
    }

    private fun upsertSheet(conn: Connection, sheet: SheetDocument) {
        val record = LegacyFlatSheetPersistenceAdapter.fromDocument(sheet)
        conn.prepareStatement(
            """
            INSERT INTO sheets (
                id, name, row_count, column_count, position_x, position_y, frame_width, frame_height, z_index, cells_json, revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                row_count = excluded.row_count,
                column_count = excluded.column_count,
                position_x = excluded.position_x,
                position_y = excluded.position_y,
                frame_width = excluded.frame_width,
                frame_height = excluded.frame_height,
                z_index = excluded.z_index,
                cells_json = excluded.cells_json,
                revision = sheets.revision + 1
            """.trimIndent(),
        ).use { statement ->
            statement.setBytes(1, record.id.toUuidBytes())
            statement.setString(2, record.name)
            statement.setInt(3, record.rowCount)
            statement.setInt(4, record.columnCount)
            statement.setDouble(5, record.positionX)
            statement.setDouble(6, record.positionY)
            statement.setDouble(7, record.frameWidth)
            statement.setDouble(8, record.frameHeight)
            statement.setInt(9, record.zIndex)
            statement.setString(10, json.encodeToString(PersistedCells.serializer(), PersistedCells(record.cells)))
            statement.executeUpdate()
        }
    }

    private fun updateSheetWithExpectedRevision(
        conn: Connection,
        sheet: SheetDocument,
        expectedRevision: Long,
    ) {
        val record = LegacyFlatSheetPersistenceAdapter.fromDocument(sheet)
        val updatedRows = conn.prepareStatement(
            """
            UPDATE sheets SET
                name = ?,
                row_count = ?,
                column_count = ?,
                position_x = ?,
                position_y = ?,
                frame_width = ?,
                frame_height = ?,
                z_index = ?,
                cells_json = ?,
                revision = revision + 1
            WHERE id = ? AND revision = ?
            """.trimIndent(),
        ).use { statement ->
            statement.setString(1, record.name)
            statement.setInt(2, record.rowCount)
            statement.setInt(3, record.columnCount)
            statement.setDouble(4, record.positionX)
            statement.setDouble(5, record.positionY)
            statement.setDouble(6, record.frameWidth)
            statement.setDouble(7, record.frameHeight)
            statement.setInt(8, record.zIndex)
            statement.setString(9, json.encodeToString(PersistedCells.serializer(), PersistedCells(record.cells)))
            statement.setBytes(10, record.id.toUuidBytes())
            statement.setLong(11, expectedRevision)
            statement.executeUpdate()
        }

        if (updatedRows == 0) {
            throw SheetRevisionConflict(record.id, expectedRevision, loadSheetRevision(conn, record.id) ?: -1)
        }
    }

    private fun deleteSheetWithExpectedRevision(conn: Connection, sheetId: String, expectedRevision: Long) {
        val deletedRows = conn.prepareStatement("DELETE FROM sheets WHERE id = ? AND revision = ?").use { statement ->
            statement.setBytes(1, sheetId.toUuidBytes())
            statement.setLong(2, expectedRevision)
            statement.executeUpdate()
        }

        if (deletedRows == 0) {
            throw SheetRevisionConflict(sheetId, expectedRevision, loadSheetRevision(conn, sheetId) ?: -1)
        }
    }

    private fun loadSheetRevision(conn: Connection, sheetId: String): Long? {
        return conn.prepareStatement("SELECT revision FROM sheets WHERE id = ?").use { statement ->
            statement.setBytes(1, sheetId.toUuidBytes())
            statement.executeQuery().use { rs ->
                if (rs.next()) rs.getLong("revision") else null
            }
        }
    }

    private fun deleteSheet(conn: Connection, sheetId: String) {
        conn.prepareStatement("DELETE FROM sheets WHERE id = ?").use { statement ->
            statement.setBytes(1, sheetId.toUuidBytes())
            statement.executeUpdate()
        }
    }

    private fun ResultSet.toLegacyFlatSheetRecord(): LegacyFlatSheetRecord {
        return LegacyFlatSheetRecord(
            id = getBytes("id").toUuidString(),
            name = getString("name"),
            revision = getLong("revision"),
            positionX = getDouble("position_x"),
            positionY = getDouble("position_y"),
            frameWidth = getDouble("frame_width"),
            frameHeight = getDouble("frame_height"),
            zIndex = getInt("z_index"),
            rowCount = getInt("row_count"),
            columnCount = getInt("column_count"),
            cells = json.decodeFromString(PersistedCells.serializer(), getString("cells_json")).cells,
        )
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
            conn.createStatement().use { it.execute("PRAGMA busy_timeout = 5000") }
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

private fun String.toUuidBytes(): ByteArray {
    val uuid = UUID.fromString(this)
    return ByteBuffer.allocate(16)
        .putLong(uuid.mostSignificantBits)
        .putLong(uuid.leastSignificantBits)
        .array()
}

private fun ByteArray.toUuidString(): String {
    require(size == 16) { "Stored sheet id must be exactly 16 bytes" }
    val bytes = ByteBuffer.wrap(this)
    return UUID(bytes.long, bytes.long).toString()
}

@Serializable
private data class PersistedCells(
    val cells: Map<String, String>,
)

/**
 * Exact shape of the pre-normalization `sheets` row.
 *
 * Removed by sheetspace-z5q.6 when manifest, document, frame, and tabular
 * persistence become separate normalized concerns.
 */
private data class LegacyFlatSheetRecord(
    val id: String,
    val name: String,
    val revision: Long,
    val positionX: Double,
    val positionY: Double,
    val frameWidth: Double,
    val frameHeight: Double,
    val zIndex: Int,
    val rowCount: Int,
    val columnCount: Int,
    val cells: Map<String, String>,
)

private object LegacyFlatSheetPersistenceAdapter {
    fun toDocument(record: LegacyFlatSheetRecord): SheetDocument = SheetDocument(
        id = SheetId(record.id),
        name = record.name,
        revision = record.revision,
        frame = FrameState(
            position = WorkspacePosition(record.positionX, record.positionY),
            size = SheetFrameSize(record.frameWidth, record.frameHeight),
            zIndex = record.zIndex,
        ),
        content = TabularContent(
            rowCount = record.rowCount,
            columnCount = record.columnCount,
            cells = record.cells,
        ),
    )

    fun fromDocument(document: SheetDocument): LegacyFlatSheetRecord {
        val tabular = document.tabularContent
        return LegacyFlatSheetRecord(
            id = document.id.value,
            name = document.name,
            revision = document.revision,
            positionX = document.frame.position.x,
            positionY = document.frame.position.y,
            frameWidth = document.frame.size.width,
            frameHeight = document.frame.size.height,
            zIndex = document.frame.zIndex,
            rowCount = tabular.rowCount,
            columnCount = tabular.columnCount,
            cells = tabular.cells,
        )
    }
}
