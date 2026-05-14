package com.sheetspace

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.flywaydb.core.Flyway
import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import java.sql.ResultSet

class WorkbookRepository(dbPath: Path) {
    private val jdbcUrl = "jdbc:sqlite:${dbPath.toAbsolutePath()}"
    private val json = Json { ignoreUnknownKeys = false }

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
                workbook.sheets.forEachIndexed { index, sheet ->
                    upsertSheet(conn, sheet, index)
                }
            }
        }
    }

    fun createSheet(sheet: Sheet): Workbook = updateWorkbook { workbook ->
        when (val result = com.sheetspace.createSheet(
            id = sheet.id,
            name = sheet.name,
            existingSheets = workbook.sheets,
            position = sheet.position,
            zIndex = sheet.zIndex,
        )) {
            is SheetNameResult.Valid -> workbook.copy(sheets = workbook.sheets + result.value)
            is SheetNameResult.Invalid -> workbook
        }
    }

    fun renameSheet(sheetId: String, nextName: String): Workbook = updateWorkbook { workbook ->
        when (val result = com.sheetspace.renameSheet(workbook, sheetId, nextName)) {
            is WorkbookResult.Valid -> result.workbook
            else -> workbook
        }
    }

    fun updateSheetPosition(sheetId: String, position: WorkspacePosition): Workbook = updateWorkbook { workbook ->
        workbook.copy(
            sheets = workbook.sheets.map { sheet ->
                if (sheet.id == sheetId) sheet.copy(position = position) else sheet
            },
        )
    }

    fun updateSheetZIndex(sheetId: String, zIndex: Int): Workbook = updateWorkbook { workbook ->
        workbook.copy(
            sheets = workbook.sheets.map { sheet ->
                if (sheet.id == sheetId) sheet.copy(zIndex = zIndex) else sheet
            },
        )
    }

    fun updateCell(sheetId: String, cellAddress: String, raw: String): Workbook = updateWorkbook { workbook ->
        workbook.copy(
            sheets = workbook.sheets.map { sheet ->
                if (sheet.id != sheetId) {
                    sheet
                } else {
                    val nextCells = if (raw.isEmpty()) {
                        sheet.cells - cellAddress
                    } else {
                        sheet.cells + (cellAddress to CellContent(raw = raw))
                    }
                    sheet.copy(cells = nextCells)
                }
            },
        )
    }

    fun appendRow(sheetId: String): Workbook = updateWorkbook { workbook ->
        workbook.copy(
            sheets = workbook.sheets.map { sheet ->
                if (sheet.id == sheetId) com.sheetspace.appendRow(sheet) else sheet
            },
        )
    }

    fun appendColumn(sheetId: String): Workbook = updateWorkbook { workbook ->
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

    private fun updateWorkbook(transform: (Workbook) -> Workbook): Workbook = connection { conn ->
        transaction(conn) {
            val current = loadWorkbook(conn)
            val updated = transform(current)
            saveChangedSheets(conn, current, updated)
            updated
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
        val sheets = conn.prepareStatement(
            """
            SELECT id, name, row_count, column_count, position_x, position_y, z_index, cells_json
            FROM sheets
            ORDER BY display_order ASC
            """.trimIndent(),
        ).use { statement ->
            statement.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) {
                        add(rs.toSheet())
                    }
                }
            }
        }

        return emptyWorkbook().copy(sheets = sheets)
    }

    private fun saveChangedSheets(conn: Connection, current: Workbook, updated: Workbook) {
        val updatedById = updated.sheets.associateBy { it.id }
        val currentById = current.sheets.associateBy { it.id }

        for (sheet in current.sheets) {
            if (sheet.id !in updatedById) {
                deleteSheet(conn, sheet.id)
            }
        }

        updated.sheets.forEachIndexed { index, sheet ->
            if (currentById[sheet.id] != sheet || current.sheets.indexOfFirst { it.id == sheet.id } != index) {
                upsertSheet(conn, sheet, index)
            }
        }
    }

    private fun upsertSheet(conn: Connection, sheet: Sheet, displayOrder: Int) {
        conn.prepareStatement(
            """
            INSERT INTO sheets (
                id, display_order, name, row_count, column_count, position_x, position_y, z_index, cells_json, revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(id) DO UPDATE SET
                display_order = excluded.display_order,
                name = excluded.name,
                row_count = excluded.row_count,
                column_count = excluded.column_count,
                position_x = excluded.position_x,
                position_y = excluded.position_y,
                z_index = excluded.z_index,
                cells_json = excluded.cells_json,
                revision = sheets.revision + 1
            """.trimIndent(),
        ).use { statement ->
            statement.setString(1, sheet.id)
            statement.setInt(2, displayOrder)
            statement.setString(3, sheet.name)
            statement.setInt(4, sheet.rowCount)
            statement.setInt(5, sheet.columnCount)
            statement.setDouble(6, sheet.position.x)
            statement.setDouble(7, sheet.position.y)
            statement.setInt(8, sheet.zIndex)
            statement.setString(9, json.encodeToString(PersistedCells.serializer(), PersistedCells(sheet.cells)))
            statement.executeUpdate()
        }
    }

    private fun deleteSheet(conn: Connection, sheetId: String) {
        conn.prepareStatement("DELETE FROM sheets WHERE id = ?").use { statement ->
            statement.setString(1, sheetId)
            statement.executeUpdate()
        }
    }

    private fun ResultSet.toSheet(): Sheet {
        return Sheet(
            id = getString("id"),
            name = getString("name"),
            position = WorkspacePosition(
                x = getDouble("position_x"),
                y = getDouble("position_y"),
            ),
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
            return block(conn)
        }
    }
}

@Serializable
private data class PersistedCells(
    val cells: Map<String, CellContent>,
)
