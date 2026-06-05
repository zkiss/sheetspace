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

class SheetRevisionConflict(
    val sheetId: String,
    val expectedRevision: Long,
    val actualRevision: Long,
) : RuntimeException("Sheet $sheetId revision conflict: expected $expectedRevision, actual $actualRevision")

class SheetNameRejected(
    val reason: SheetNameError,
) : RuntimeException("Sheet name rejected: $reason")

class UnknownSheetUpdate(
    val sheetId: String,
) : RuntimeException("Unknown sheet: $sheetId")

class WorkbookRepository(dbPath: Path) {
    private val jdbcUrl = "jdbc:sqlite:${dbPath.toAbsolutePath()}"
    private val json = Json { ignoreUnknownKeys = false }
    private val sheetCreationLock = Any()

    init {
        initialize()
    }

    fun loadWorkbook(): Workbook = connection { conn -> loadWorkbook(conn) }

    fun saveWorkbook(workbook: Workbook) {
        require(workbook.version == WORKBOOK_SCHEMA_VERSION) {
            "Unsupported workbook version: ${workbook.version}"
        }
        connection { conn ->
            transaction(conn) {
                conn.createStatement().use { it.executeUpdate("DELETE FROM sheets") }
                workbook.sheets.forEach { sheet ->
                    upsertSheet(conn, sheet)
                }
            }
        }
    }

    fun createSheet(sheet: Sheet, assignDefaultZIndex: Boolean = false): Workbook = synchronized(sheetCreationLock) {
        updateWorkbook { workbook ->
            when (val result = validateSheetName(sheet.name, workbook.sheets)) {
                is SheetNameResult.Valid -> workbook.copy(
                    sheets = workbook.sheets + sheet.copy(
                        name = result.value,
                        zIndex = if (assignDefaultZIndex) {
                            (workbook.sheets.maxOfOrNull { it.zIndex } ?: 0) + 1
                        } else {
                            sheet.zIndex
                        },
                    ),
                )
                is SheetNameResult.Invalid -> throw SheetNameRejected(result.reason)
            }
        }
    }

    fun updateSheet(
        sheetId: String,
        expectedRevision: Long?,
        name: String? = null,
        position: WorkspacePosition? = null,
        frameSize: SheetFrameSize? = null,
        zIndex: Int? = null,
    ): Workbook = updateWorkbook(sheetId, expectedRevision) { workbook ->
        val renamed = if (name == null) {
            workbook
        } else {
            when (val result = com.sheetspace.renameSheet(workbook, sheetId, name)) {
                is WorkbookResult.Valid -> result.workbook
                is WorkbookResult.InvalidName -> throw SheetNameRejected(result.reason)
                WorkbookResult.UnknownSheet -> throw UnknownSheetUpdate(sheetId)
            }
        }

        renamed.copy(
            sheets = renamed.sheets.map { sheet ->
                if (sheet.id != sheetId) {
                    sheet
                } else {
                    sheet.copy(
                        position = position ?: sheet.position,
                        frameSize = frameSize ?: sheet.frameSize,
                        zIndex = zIndex ?: sheet.zIndex,
                    )
                }
            },
        )
    }

    fun renameSheet(sheetId: String, nextName: String): Workbook = updateSheet(sheetId, null, name = nextName)

    fun updateSheetPosition(sheetId: String, position: WorkspacePosition): Workbook =
        updateSheet(sheetId, null, position = position)

    fun updateSheetFrameSize(sheetId: String, frameSize: SheetFrameSize): Workbook =
        updateSheet(sheetId, null, frameSize = frameSize)

    fun updateSheetZIndex(sheetId: String, zIndex: Int): Workbook = updateSheet(sheetId, null, zIndex = zIndex)

    fun deleteSheet(sheetId: String, expectedRevision: Long? = null): Workbook = updateWorkbook(sheetId, expectedRevision) { workbook ->
        if (workbook.sheets.none { it.id == sheetId }) {
            throw UnknownSheetUpdate(sheetId)
        }

        workbook.copy(sheets = workbook.sheets.filterNot { it.id == sheetId })
    }

    fun updateCell(
        sheetId: String,
        cellAddress: String,
        raw: String,
        expectedRevision: Long? = null,
        sheetReferences: List<FormulaSheetReference> = emptyList(),
    ): Workbook =
        updateWorkbook(sheetId, expectedRevision) { workbook ->
            workbook.copy(
                sheets = workbook.sheets.map { sheet ->
                    if (sheet.id != sheetId) {
                        sheet
                    } else {
                        val nextCells = if (raw.isEmpty()) {
                            sheet.cells - cellAddress
                        } else {
                            sheet.cells + (cellAddress to CellContent(raw = raw, sheetReferences = sheetReferences))
                        }
                        sheet.copy(cells = nextCells)
                    }
                },
            )
        }

    fun appendRow(sheetId: String, expectedRevision: Long? = null): Workbook =
        updateWorkbook(sheetId, expectedRevision) { workbook ->
            workbook.copy(
                sheets = workbook.sheets.map { sheet ->
                    if (sheet.id == sheetId) com.sheetspace.appendRow(sheet) else sheet
                },
            )
        }

    fun appendColumn(sheetId: String, expectedRevision: Long? = null): Workbook =
        updateWorkbook(sheetId, expectedRevision) { workbook ->
            workbook.copy(
                sheets = workbook.sheets.map { sheet ->
                    if (sheet.id == sheetId) com.sheetspace.appendColumn(sheet) else sheet
                },
            )
        }

    private fun initialize() {
        Flyway.configure()
            .dataSource(jdbcUrl, null, null)
            .locations("classpath:db/migration")
            .load()
            .migrate()
    }

    private fun updateWorkbook(
        lockedSheetId: String? = null,
        expectedRevision: Long? = null,
        transform: (Workbook) -> Workbook,
    ): Workbook = connection { conn ->
        if (lockedSheetId != null && expectedRevision != null) {
            val current = loadWorkbook(conn)
            val currentSheet = current.sheets.find { it.id == lockedSheetId }
            val updated = transform(current)

            if (currentSheet != null && currentSheet.revision != expectedRevision) {
                throw SheetRevisionConflict(lockedSheetId, expectedRevision, currentSheet.revision)
            }

            val updatedSheet = updated.sheets.find { it.id == lockedSheetId }
            if (
                currentSheet != null &&
                updatedSheet != null &&
                currentSheet != updatedSheet
            ) {
                updateSheetWithExpectedRevision(conn, updatedSheet, expectedRevision)
            }
            if (currentSheet != null && updatedSheet == null) {
                deleteSheetWithExpectedRevision(conn, lockedSheetId, expectedRevision)
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

    internal fun loadStoredSchemaVersion(): Int? = connection { conn ->
        conn.prepareStatement("SELECT schema_version FROM workbook_metadata WHERE singleton_key = 1")
            .use { statement ->
                statement.executeQuery().use { rs ->
                    if (rs.next()) rs.getInt("schema_version") else null
                }
            }
    }

    private fun loadWorkbook(conn: Connection): Workbook {
        val storedSheets = conn.prepareStatement(
            """
            SELECT id, name, row_count, column_count, position_x, position_y, frame_width, frame_height, z_index, cells_json, revision
            FROM sheets
            ORDER BY hex(id) ASC
            """.trimIndent(),
        ).use { statement ->
            statement.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) {
                        add(rs.toStoredSheet())
                    }
                }
            }
        }

        val sheetsById = storedSheets.associate { it.sheet.id to it.sheet }
        return emptyWorkbook().copy(
            sheets = storedSheets.map { stored ->
                stored.sheet.copy(cells = hydrateCells(stored.cells, sheetsById))
            },
        )
    }

    private fun saveChangedSheets(conn: Connection, current: Workbook, updated: Workbook) {
        val updatedById = updated.sheets.associateBy { it.id }
        val currentById = current.sheets.associateBy { it.id }

        for (sheet in current.sheets) {
            if (sheet.id !in updatedById) {
                deleteSheet(conn, sheet.id)
            }
        }

        updated.sheets.forEach { sheet ->
            if (currentById[sheet.id] != sheet) {
                upsertSheet(conn, sheet)
            }
        }
    }

    private fun upsertSheet(conn: Connection, sheet: Sheet) {
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
            statement.setBytes(1, sheet.id.toUuidBytes())
            statement.setString(2, sheet.name)
            statement.setInt(3, sheet.rowCount)
            statement.setInt(4, sheet.columnCount)
            statement.setDouble(5, sheet.position.x)
            statement.setDouble(6, sheet.position.y)
            statement.setDouble(7, sheet.frameSize.width)
            statement.setDouble(8, sheet.frameSize.height)
            statement.setInt(9, sheet.zIndex)
            statement.setString(10, json.encodeToString(PersistedCells.serializer(), persistCells(sheet.cells)))
            statement.executeUpdate()
        }
    }

    private fun updateSheetWithExpectedRevision(
        conn: Connection,
        sheet: Sheet,
        expectedRevision: Long,
    ) {
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
            statement.setString(1, sheet.name)
            statement.setInt(2, sheet.rowCount)
            statement.setInt(3, sheet.columnCount)
            statement.setDouble(4, sheet.position.x)
            statement.setDouble(5, sheet.position.y)
            statement.setDouble(6, sheet.frameSize.width)
            statement.setDouble(7, sheet.frameSize.height)
            statement.setInt(8, sheet.zIndex)
            statement.setString(9, json.encodeToString(PersistedCells.serializer(), persistCells(sheet.cells)))
            statement.setBytes(10, sheet.id.toUuidBytes())
            statement.setLong(11, expectedRevision)
            statement.executeUpdate()
        }

        if (updatedRows == 0) {
            throw SheetRevisionConflict(sheet.id, expectedRevision, loadSheetRevision(conn, sheet.id) ?: -1)
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

    private fun ResultSet.toStoredSheet(): StoredSheet {
        val persistedCells = json.decodeFromString(PersistedCells.serializer(), getString("cells_json")).cells
        return StoredSheet(
            sheet = Sheet(
                id = getBytes("id").toUuidString(),
                name = getString("name"),
                revision = getLong("revision"),
                position = WorkspacePosition(
                    x = getDouble("position_x"),
                    y = getDouble("position_y"),
                ),
                frameSize = SheetFrameSize(
                    width = getDouble("frame_width"),
                    height = getDouble("frame_height"),
                ),
                zIndex = getInt("z_index"),
                rowCount = getInt("row_count"),
                columnCount = getInt("column_count"),
                cells = emptyMap(),
            ),
            cells = persistedCells,
        )
    }

    private fun persistCells(cells: Map<String, CellContent>): PersistedCells {
        return PersistedCells(
            cells = cells.mapValues { (_, cell) ->
                PersistedCellContent(
                    raw = cell.raw,
                    sheetReferences = cell.sheetReferences,
                )
            },
        )
    }

    private fun hydrateCells(
        cells: Map<String, PersistedCellContent>,
        sheetsById: Map<String, Sheet>,
    ): Map<String, CellContent> {
        return cells.mapValues { (_, cell) ->
            val raw = StringBuilder()
            val references = buildList {
                var copiedUntil = 0
                cell.sheetReferences.sortedBy { it.startIndex }.forEach { reference ->
                    val token = cell.raw.substring(reference.startIndex, reference.endIndex)
                    val parsedToken = parseSheetReferenceToken(token)
                    val sheet = sheetsById[reference.sheetId]
                    val displayToken = if (parsedToken == null || sheet == null || parsedToken.sheetName == sheet.name) {
                        token
                    } else {
                        formatSheetReferenceToken(sheet.name, parsedToken.quoted)
                    }

                    raw.append(cell.raw, copiedUntil, reference.startIndex)
                    val startIndex = raw.length
                    raw.append(displayToken)
                    add(FormulaSheetReference(startIndex, raw.length, reference.sheetId))
                    copiedUntil = reference.endIndex
                }
                raw.append(cell.raw, copiedUntil, cell.raw.length)
            }
            CellContent(raw = raw.toString(), sheetReferences = references)
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
            conn.createStatement().use { it.execute("PRAGMA busy_timeout = 5000") }
            return block(conn)
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
    val cells: Map<String, PersistedCellContent>,
)

@Serializable
private data class PersistedCellContent(
    val raw: String,
    val sheetReferences: List<FormulaSheetReference> = emptyList(),
)

private data class StoredSheet(
    val sheet: Sheet,
    val cells: Map<String, PersistedCellContent>,
)

private data class SheetReferenceToken(
    val startIndex: Int,
    val endIndex: Int,
    val sheetName: String,
)

private data class ParsedSheetReferenceToken(
    val sheetName: String,
    val quoted: Boolean,
)

private fun findSheetReferenceTokens(raw: String): List<SheetReferenceToken> {
    if (!raw.startsWith("=")) {
        return emptyList()
    }

    return buildList {
        raw.forEachIndexed { separatorIndex, char ->
            if (char != '!') {
                return@forEachIndexed
            }
            if (!hasA1ReferenceAfter(raw, separatorIndex)) {
                return@forEachIndexed
            }

            val endIndex = raw.substring(0, separatorIndex).indexOfLast { !it.isWhitespace() } + 1
            val startIndex = findSheetReferenceTokenStart(raw, endIndex) ?: return@forEachIndexed
            val parsed = parseSheetReferenceToken(raw.substring(startIndex, endIndex)) ?: return@forEachIndexed
            add(SheetReferenceToken(startIndex, endIndex, parsed.sheetName))
        }
    }
}

private fun hasA1ReferenceAfter(raw: String, separatorIndex: Int): Boolean {
    val referenceStart = (separatorIndex + 1 until raw.length).firstOrNull { !raw[it].isWhitespace() } ?: return false
    val address = Regex("[A-Za-z]+[1-9][0-9]*").find(raw, referenceStart) ?: return false
    if (address.range.first != referenceStart) {
        return false
    }

    val nextChar = raw.getOrNull(address.range.last + 1)
    return nextChar == null || nextChar.isWhitespace() || nextChar in ":,)"
}

private fun findSheetReferenceTokenStart(raw: String, endIndex: Int): Int? {
    if (endIndex <= 0) {
        return null
    }
    if (raw[endIndex - 1] != '\'') {
        val boundary = raw.lastIndexOfAny(charArrayOf('(', ',', ':'), endIndex - 1) + 1
        return (boundary until endIndex).firstOrNull { !raw[it].isWhitespace() }
    }

    var cursor = endIndex - 2
    while (cursor >= 0) {
        if (raw[cursor] != '\'') {
            cursor -= 1
            continue
        }
        if (cursor > 0 && raw[cursor - 1] == '\'') {
            cursor -= 2
            continue
        }
        return cursor
    }

    return null
}

private fun parseSheetReferenceToken(token: String): ParsedSheetReferenceToken? {
    val trimmedToken = token.trim()
    if (!trimmedToken.startsWith("'")) {
        return trimmedToken.takeIf { it.isNotEmpty() && it.none { char -> char in "'(),:!" } }
            ?.let { ParsedSheetReferenceToken(sheetName = it, quoted = false) }
    }
    if (!trimmedToken.endsWith("'") || trimmedToken.length < 3) {
        return null
    }

    val inner = trimmedToken.substring(1, trimmedToken.length - 1)
    var cursor = 0
    while (cursor < inner.length) {
        if (inner[cursor] != '\'') {
            cursor += 1
            continue
        }
        if (cursor + 1 >= inner.length || inner[cursor + 1] != '\'') {
            return null
        }
        cursor += 2
    }
    val sheetName = inner.replace("''", "'")
    return ParsedSheetReferenceToken(sheetName = sheetName, quoted = true)
}

private fun formatSheetReferenceToken(sheetName: String, preferQuoted: Boolean): String {
    val quoted = preferQuoted || !sheetName.matches(Regex("[A-Za-z_][A-Za-z0-9_.]*"))
    return if (quoted) "'${sheetName.replace("'", "''")}'" else sheetName
}
