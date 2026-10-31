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
    private val sheetReadObserver: ((SheetReadEvent) -> Unit)? = null,
    private val calculatedAdmission: (WorkbookState, WorkbookState) -> Unit = ::rejectCalculatedOverrides,
) : WorkbookStore, AutoCloseable {
    private val database = SqliteDatabase(jdbcUrl, keepAliveConnection)
    private val updateLock = Any()

    constructor(dbPath: Path) : this("jdbc:sqlite:${dbPath.toAbsolutePath()}")

    override fun close() = database.close()

    override fun admitRecord(sheetId: SheetId, rowId: RowId, fingerprint: String, transform: (WorkbookState) -> WorkbookState): WorkbookState =
        synchronized(updateLock) {
            database.transaction { conn ->
                val reader = reader(conn)
                val existing = conn.prepareStatement("SELECT fingerprint FROM record_admissions WHERE sheet_id = ? AND row_id = ?").use { statement ->
                    statement.setBytes(1, sheetId.value.toUuidBytes())
                    statement.setBytes(2, rowId.value.toUuidBytes())
                    statement.executeQuery().use { result -> if (result.next()) result.getString(1) else null }
                }
                if (existing != null) {
                    if (existing != fingerprint) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)
                    reader.loadWorkbookBundle()
                } else {
                    val current = reader.loadWorkbookBundle()
                    val updated = transform(current)
                    validateModelMetadata(updated)
                    calculatedAdmission(current, updated)
                    SqliteWorkbookWriter(conn, reader).persistChanges(current, updated)
                    conn.prepareStatement("INSERT INTO record_admissions (sheet_id, row_id, fingerprint) VALUES (?, ?, ?)").use { statement ->
                        statement.setBytes(1, sheetId.value.toUuidBytes())
                        statement.setBytes(2, rowId.value.toUuidBytes())
                        statement.setString(3, fingerprint)
                        statement.executeUpdate()
                    }
                    reader.loadWorkbookBundle()
                }
            }
        }

    override fun loadManifest(): WorkbookManifest = database.transaction { conn ->
        reader(conn).loadManifest()
    }

    override fun loadSheet(sheetId: SheetId): SheetDocument? {
        if (sheetId.value.toUuidBytesOrNull() == null) return null
        return database.transaction { conn -> reader(conn).loadSheet(sheetId) }
    }

    override fun loadWorkbookBundle(): WorkbookState = database.transaction { conn ->
        SqliteWorkbookReader(conn, aggregateReadCheckpoint, sheetReadObserver).loadWorkbookBundle()
    }

    override fun loadDataModels(): Map<String, DataModel> = database.transaction { conn ->
        reader(conn).loadDataModels()
    }

    override fun saveWorkbook(workbook: WorkbookState) {
        require(workbook.manifest.version == WORKBOOK_SCHEMA_VERSION) {
            "Unsupported workbook version: ${workbook.manifest.version}"
        }
        synchronized(updateLock) {
            database.transaction { conn ->
                val reader = reader(conn)
                validateModelMetadata(workbook)
                calculatedAdmission(reader.loadWorkbookBundle(), workbook)
                SqliteWorkbookWriter(conn, reader).replaceAll(workbook)
            }
        }
    }

    /**
     * Writes cells after rejecting every target owned by a calculated property.
     *
     * Ownership is decided from the written sheets and the current declarations, so an ordinary
     * cell edit reads only the sheets it touches instead of decoding the whole workbook.
     */
    override fun writeCells(
        expectedRevisions: List<ExpectedSheetRevision>,
        writes: List<SheetCellWrite>,
    ): List<SheetDocument> {
        require(writes.isNotEmpty()) { "At least one cell write is required" }
        require(expectedRevisions.isNotEmpty()) { "Expected sheet revisions are required" }
        require(writes.map { Triple(it.sheetId, it.rowId, it.columnId) }.distinct().size == writes.size) {
            "Cell writes must target distinct coordinates"
        }
        require(expectedRevisions.map(ExpectedSheetRevision::sheetId).distinct().size == expectedRevisions.size) {
            "Expected sheet revisions must be distinct"
        }
        return synchronized(updateLock) {
            database.transaction { conn ->
                val reader = reader(conn)
                val writtenSheets = writes.map(SheetCellWrite::sheetId).distinct().associateWith { sheetId ->
                    reader.loadSheet(SheetId(sheetId)) ?: throw NoSuchElementException("Sheet not found: $sheetId")
                }
                val dataModels = reader.loadDataModels()
                writes.forEach { write ->
                    val sheet = writtenSheets.getValue(write.sheetId)
                    if (ColumnId(write.columnId) in calculatedModelColumns(sheet, dataModels)) {
                        throw WorkbookApplicationException(WorkbookApplicationError.CALCULATED_CELL_WRITE)
                    }
                }
                SqliteWorkbookWriter(conn, reader).writeCells(expectedRevisions, writes, writtenSheets)
            }
        }
    }

    override fun writePresentation(expectedRevision: ExpectedSheetRevision, writes: List<AxisSizeWrite>, formatWrites: List<FormatWrite>): SheetDocument =
        synchronized(updateLock) {
            database.transaction { conn ->
                val reader = reader(conn)
                SqliteWorkbookWriter(conn, reader).writePresentation(expectedRevision, writes, formatWrites)
            }
        }

    override fun updateSheetZOrder(writes: List<SheetZOrderWrite>): List<SheetDocument> {
        require(writes.isNotEmpty()) { "At least one z-order write is required" }
        require(writes.map { it.expectedRevision.sheetId }.distinct().size == writes.size) {
            "Z-order writes must target distinct sheets"
        }
        return synchronized(updateLock) {
            database.transaction { conn ->
                val reader = reader(conn)
                val writer = SqliteWorkbookWriter(conn, reader)
                val current = reader.loadWorkbookBundle()
                val currentSheets = writes.associateWith { write ->
                    val expected = write.expectedRevision
                    val sheet = current.findSheet(SheetId(expected.sheetId))
                        ?: throw NoSuchElementException("Sheet not found: ${expected.sheetId}")
                    if (sheet.revision != expected.revision) {
                        throw SheetRevisionConflict(expected.sheetId, expected.revision, sheet.revision)
                    }
                    sheet
                }
                val updated = writes.fold(current) { workbook, write ->
                    workbook.replaceSheet(
                        currentSheets.getValue(write).updateFrame { frame -> frame.update(zIndex = write.zIndex) },
                    )
                }
                writer.persistChanges(current, updated)
                writes.map { write ->
                    reader.loadSheet(SheetId(write.expectedRevision.sheetId))
                        ?: error("Updated sheet disappeared: ${write.expectedRevision.sheetId}")
                }
            }
        }
    }

    override fun updateWorkbook(
        expectedRevision: ExpectedSheetRevision?,
        transform: (WorkbookState) -> WorkbookState,
    ): WorkbookState = synchronized(updateLock) {
        database.transaction { conn ->
            val reader = reader(conn)
            val writer = SqliteWorkbookWriter(conn, reader)
            val current = reader.loadWorkbookBundle()
            val updated = transform(current)
            validateModelMetadata(updated)
            calculatedAdmission(current, updated)
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
        reader(conn).loadStoredSchemaVersion()
    }

    /** Every sheet read of this store is observable, so read amplification can be asserted. */
    private fun reader(conn: Connection) = SqliteWorkbookReader(conn, sheetReadObserver = sheetReadObserver)

    companion object {
        internal fun inMemory(
            sheetReadObserver: ((SheetReadEvent) -> Unit)? = null,
            calculatedAdmission: (WorkbookState, WorkbookState) -> Unit = ::rejectCalculatedOverrides,
        ): SqliteWorkbookStore {
            val jdbcUrl = "jdbc:sqlite:file:sheetspace-${UUID.randomUUID()}?mode=memory&cache=shared"
            return SqliteWorkbookStore(
                jdbcUrl,
                DriverManager.getConnection(jdbcUrl),
                sheetReadObserver = sheetReadObserver,
                calculatedAdmission = calculatedAdmission,
            )
        }
    }
}

private fun validateModelMetadata(workbook: WorkbookState) {
    require(workbook.dataModels.keys.all { it.toUuidBytesOrNull() != null }) { "Model IDs must be UUIDs" }
    workbook.dataModels.values.forEach { model ->
        require(model.id in workbook.dataModels && model.name.isNotBlank()) { "Model ID and name are required" }
        require(model.columns.map { it.id }.distinct().size == model.columns.size && model.columns.map { it.name.trim() }.distinct().size == model.columns.size) { "Model columns must have unique identities and names" }
        model.columns.forEach { column ->
            require(column.id.isNotBlank() && column.id.toUuidBytesOrNull() != null && column.name.isNotBlank()) { "Column ID and name are required" }
            if (column is CalculatedModelColumn) require(column.formula.isNotBlank()) { "Calculated columns require a formula" }
        }
    }
    workbook.documents.values.forEach { sheet ->
        require(validModelColumnBindings(sheet, workbook.dataModels)) { "Invalid sheet model column bindings" }
    }
}
