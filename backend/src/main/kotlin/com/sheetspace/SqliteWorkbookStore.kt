package com.sheetspace

import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import java.util.UUID

/**
 * SQLite [WorkbookStore] adapter.
 *
 * Dependency direction is deliberately one-way: this facade owns transaction orchestration,
 * [SqliteDatabase] owns JDBC lifecycle, and transaction-scoped readers/writers own SQL for their
 * aggregate responsibilities. [SqliteCellWriter] is the prepared sparse-cell operation used by
 * aggregate writes. Domain and [WorkbookStore] contracts do not depend on these SQLite details.
 */
class SqliteWorkbookStore internal constructor(
    internal val jdbcUrl: String,
    keepAliveConnection: Connection? = null,
    private val aggregateReadCheckpoint: (() -> Unit)? = null,
    private val sheetReadObserver: ((SheetId) -> Unit)? = null,
) : WorkbookStore, AutoCloseable {
    private val database = SqliteDatabase(jdbcUrl, keepAliveConnection)
    private val updateLock = Any()

    constructor(dbPath: Path) : this("jdbc:sqlite:${dbPath.toAbsolutePath()}")

    override fun close() = database.close()

    override fun loadManifest(): WorkbookManifest = database.transaction { conn ->
        SqliteWorkbookReader(conn).loadManifest()
    }

    override fun loadSheet(sheetId: SheetId): SheetDocument? {
        if (sheetId.value.toUuidBytesOrNull() == null) return null
        return database.transaction { conn -> SqliteWorkbookReader(conn, sheetReadObserver = sheetReadObserver).loadSheet(sheetId) }
    }

    override fun loadWorkbookBundle(): WorkbookState = database.transaction { conn ->
        SqliteWorkbookReader(conn, aggregateReadCheckpoint, sheetReadObserver).loadWorkbookBundle()
    }

    override fun saveWorkbook(workbook: WorkbookState) {
        require(workbook.manifest.version == WORKBOOK_SCHEMA_VERSION) {
            "Unsupported workbook version: ${workbook.manifest.version}"
        }
        synchronized(updateLock) {
            database.transaction { conn ->
                val reader = SqliteWorkbookReader(conn)
                SqliteWorkbookWriter(conn, reader).replaceAll(workbook)
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
            database.transaction { conn ->
                val reader = SqliteWorkbookReader(conn)
                SqliteWorkbookWriter(conn, reader).writeCells(expectedRevision, writes)
            }
        }
    }

    override fun updateWorkbook(
        expectedRevision: ExpectedSheetRevision?,
        transform: (WorkbookState) -> WorkbookState,
    ): WorkbookState = synchronized(updateLock) {
        database.transaction { conn ->
            val reader = SqliteWorkbookReader(conn)
            val writer = SqliteWorkbookWriter(conn, reader)
            val current = reader.loadWorkbookBundle()
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

            writer.persistChanges(current, updated)
            reader.loadWorkbookBundle()
        }
    }

    internal fun loadStoredSchemaVersion(): Int? = database.connection { conn ->
        SqliteWorkbookReader(conn).loadStoredSchemaVersion()
    }

    companion object {
        internal fun inMemory(sheetReadObserver: ((SheetId) -> Unit)? = null): SqliteWorkbookStore {
            val jdbcUrl = "jdbc:sqlite:file:sheetspace-${UUID.randomUUID()}?mode=memory&cache=shared"
            return SqliteWorkbookStore(
                jdbcUrl,
                DriverManager.getConnection(jdbcUrl),
                sheetReadObserver = sheetReadObserver,
            )
        }
    }
}
