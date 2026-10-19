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

    override fun saveWorkbook(
        workbook: WorkbookState,
        expectedManifestRevision: Long?,
        expectedSheetRevisions: List<ExpectedSheetRevision>,
    ) {
        require(workbook.manifest.version == WORKBOOK_SCHEMA_VERSION) {
            "Unsupported workbook version: ${workbook.manifest.version}"
        }
        synchronized(updateLock) {
            database.transaction { conn ->
                val reader = SqliteWorkbookReader(conn)
                val current = reader.loadWorkbookBundle()
                val isPristine = current == emptyWorkbookState()
                val isTransition = !isPristine && DataModelTransitionPolicy.requiresAggregateCas(current, workbook)
                val isSnapshotDeletion = isTransition && DataModelTransitionPolicy.isLiveDelete(current, workbook)
                val requiresSheetBaseline = !isPristine && DataModelTransitionPolicy.requiresBoundAppendCas(current, workbook)
                val membershipChanged = !isPristine && DataModelTransitionPolicy.changesMembershipOrOrder(current, workbook)
                if (!isPristine && !DataModelTransitionPolicy.hasAuthorizedManifestRevision(current, workbook)) {
                    throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
                }
                if ((isTransition || membershipChanged) && expectedManifestRevision != current.manifest.revision) {
                    throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
                }
                if (isTransition && !isSnapshotDeletion) validateAffectedSheetRevisions(current, workbook, expectedSheetRevisions)
                else if (!isPristine) validateSnapshotSheetRevisions(current, workbook, expectedSheetRevisions)
                if (requiresSheetBaseline) {
                    throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
                }
                if (!(if (isPristine) DataModelTransitionPolicy.permitsBootstrap(workbook)
                    else DataModelTransitionPolicy.permitsTransition(current, workbook))) {
                    throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
                }
                if (!isPristine && !DataModelTransitionPolicy.preservesStoredSheetRevisions(current, workbook)) {
                    throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
                }
                val persisted = if (isTransition) workbook.copy(manifest = workbook.manifest.copy(revision = current.manifest.revision + 1)) else workbook
                SqliteWorkbookWriter(conn, reader).replaceAll(persisted)
            }
        }
    }

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
                val reader = SqliteWorkbookReader(conn)
                SqliteWorkbookWriter(conn, reader).writeCells(expectedRevisions, writes)
            }
        }
    }

    override fun writePresentation(expectedRevision: ExpectedSheetRevision, writes: List<AxisSizeWrite>, formatWrites: List<FormatWrite>): SheetDocument =
        synchronized(updateLock) {
            database.transaction { conn ->
                val reader = SqliteWorkbookReader(conn)
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
                val reader = SqliteWorkbookReader(conn)
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
        expectedManifestRevision: Long?,
        expectedSheetRevisions: List<ExpectedSheetRevision>,
        transform: (WorkbookState) -> WorkbookState,
    ): WorkbookState = synchronized(updateLock) {
        database.transaction { conn ->
            val reader = SqliteWorkbookReader(conn)
            val writer = SqliteWorkbookWriter(conn, reader)
            val current = reader.loadWorkbookBundle()
            val transformed = transform(current)
            if (transformed.manifest.version != WORKBOOK_SCHEMA_VERSION) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            val liveCreate = expectedRevision == null && expectedSheetRevisions.isEmpty() &&
                DataModelTransitionPolicy.isLiveCreate(current, transformed)
            val liveDelete = expectedRevision?.let { expected ->
                expectedSheetRevisions.isEmpty() && SheetId(expected.sheetId) in current.documents &&
                    DataModelTransitionPolicy.isLiveDelete(current, transformed) &&
                    SheetId(expected.sheetId) !in transformed.documents
            } == true
            val hasModelTransition = !liveDelete && DataModelTransitionPolicy.requiresAggregateCas(current, transformed)
            val requiresSheetBaseline = !liveDelete && DataModelTransitionPolicy.requiresBoundAppendCas(current, transformed)
            val changedBoundSheets = DataModelTransitionPolicy.boundContentChanges(current, transformed)
            val membershipChanged = DataModelTransitionPolicy.changesMembershipOrOrder(current, transformed)
            val liveMembershipCommand = liveCreate || liveDelete
            if (!DataModelTransitionPolicy.hasAuthorizedManifestRevision(current, transformed)) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            if ((hasModelTransition || (membershipChanged && !liveMembershipCommand)) &&
                expectedManifestRevision != current.manifest.revision
            ) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            if (liveMembershipCommand && expectedManifestRevision != null &&
                expectedManifestRevision != current.manifest.revision
            ) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            if (hasModelTransition && (expectedRevision != null || transformed.manifest != current.manifest)) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            if (hasModelTransition) validateAffectedSheetRevisions(current, transformed, expectedSheetRevisions)
            if (requiresSheetBaseline && (
                    changedBoundSheets.size != 1 ||
                        expectedRevision == null ||
                        SheetId(expectedRevision.sheetId) != changedBoundSheets.single() ||
                        expectedSheetRevisions.isNotEmpty()
                    )
            ) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            if (!hasModelTransition && !requiresSheetBaseline) {
                validateOrdinaryUpdateRevisions(current, transformed, expectedRevision, expectedSheetRevisions)
            }
            if (!DataModelTransitionPolicy.preservesStoredSheetRevisions(current, transformed)) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            val authorized = if (hasModelTransition) transformed.copy(manifest = current.manifest) else transformed
            if (!DataModelTransitionPolicy.permitsTransition(current, authorized)) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            val updated = if (hasModelTransition) authorized.copy(manifest = current.manifest.copy(revision = current.manifest.revision + 1)) else transformed
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

    private fun validateAffectedSheetRevisions(
        current: WorkbookState,
        candidate: WorkbookState,
        expected: List<ExpectedSheetRevision>,
    ) {
        val affected = DataModelTransitionPolicy.affectedAggregateSheets(current, candidate)
        if (expected.map(ExpectedSheetRevision::sheetId).distinct().size != expected.size ||
            expected.map { SheetId(it.sheetId) }.toSet() != affected
        ) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        expected.forEach { guard ->
            val sheet = current.documents.getValue(SheetId(guard.sheetId))
            if (sheet.revision != guard.revision) {
                throw SheetRevisionConflict(guard.sheetId, guard.revision, sheet.revision)
            }
        }
    }

    private fun validateSnapshotSheetRevisions(
        current: WorkbookState,
        candidate: WorkbookState,
        expected: List<ExpectedSheetRevision>,
    ) = validateExactSheetRevisions(current, DataModelTransitionPolicy.changedOrDeletedSheets(current, candidate), expected)

    private fun validateOrdinaryUpdateRevisions(
        current: WorkbookState,
        candidate: WorkbookState,
        expectedRevision: ExpectedSheetRevision?,
        expectedSheetRevisions: List<ExpectedSheetRevision>,
    ) {
        val changed = DataModelTransitionPolicy.changedOrDeletedSheets(current, candidate)
        if (expectedRevision != null && expectedSheetRevisions.isNotEmpty()) {
            throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        }
        if (expectedRevision != null) {
            val target = SheetId(expectedRevision.sheetId)
            val sheet = current.documents[target]
            if (sheet == null) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            if (!DataModelTransitionPolicy.isSingletonUpdateOf(current, candidate, target) &&
                !(target !in candidate.documents && DataModelTransitionPolicy.isLiveDelete(current, candidate))
            ) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
            }
            if (sheet.revision != expectedRevision.revision) {
                throw SheetRevisionConflict(expectedRevision.sheetId, expectedRevision.revision, sheet.revision)
            }
            return
        }
        validateExactSheetRevisions(current, changed, expectedSheetRevisions)
    }

    private fun validateExactSheetRevisions(
        current: WorkbookState,
        targets: Set<SheetId>,
        expected: List<ExpectedSheetRevision>,
    ) {
        if (expected.map(ExpectedSheetRevision::sheetId).distinct().size != expected.size ||
            expected.map { SheetId(it.sheetId) }.toSet() != targets
        ) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
        expected.forEach { guard ->
            val sheet = current.documents.getValue(SheetId(guard.sheetId))
            if (sheet.revision != guard.revision) throw SheetRevisionConflict(guard.sheetId, guard.revision, sheet.revision)
        }
    }

    internal fun loadStoredSchemaVersion(): Int? = database.connection { conn ->
        SqliteWorkbookReader(conn).loadStoredSchemaVersion()
    }

    companion object {
        internal fun inMemory(sheetReadObserver: ((SheetReadEvent) -> Unit)? = null): SqliteWorkbookStore {
            val jdbcUrl = "jdbc:sqlite:file:sheetspace-${UUID.randomUUID()}?mode=memory&cache=shared"
            return SqliteWorkbookStore(
                jdbcUrl,
                DriverManager.getConnection(jdbcUrl),
                sheetReadObserver = sheetReadObserver,
            )
        }
    }
}
