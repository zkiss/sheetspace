package com.sheetspace

import java.sql.Connection

/** Reads manifest and sheet aggregates from one caller-owned transaction snapshot. */
internal class SqliteWorkbookReader(
    private val connection: Connection,
    private val aggregateReadCheckpoint: (() -> Unit)? = null,
) {
    fun loadWorkbook(): WorkbookState {
        val manifest = loadManifest()
        aggregateReadCheckpoint?.invoke()
        val documents = manifest.sheetIds.associateWith { sheetId ->
            loadSheet(sheetId) ?: error("Manifest references missing sheet: ${sheetId.value}")
        }
        return WorkbookState(manifest, documents)
    }

    fun loadManifest(): WorkbookManifest {
        val metadata = connection.prepareStatement(
            "SELECT schema_version, manifest_revision FROM workbook_metadata WHERE singleton_key = 1",
        ).use { statement ->
            statement.executeQuery().use { rs ->
                check(rs.next()) { "Workbook metadata is missing" }
                rs.getInt("schema_version") to rs.getLong("manifest_revision")
            }
        }
        val sheetIds = connection.prepareStatement(
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

    fun loadSheet(sheetId: SheetId): SheetDocument? {
        val document = connection.prepareStatement(
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
        return SheetDocument(
            id = document.id,
            name = document.name,
            revision = document.revision,
            frame = document.frame,
            content = TabularContent(
                rows = loadRows(sheetId),
                columns = loadColumns(sheetId),
                cellContents = loadCells(sheetId),
            ),
        )
    }

    fun loadSheetRevision(sheetId: SheetId): Long? =
        connection.prepareStatement("SELECT revision FROM sheet_documents WHERE id = ?").use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.executeQuery().use { rs ->
                if (rs.next()) rs.getLong("revision") else null
            }
        }

    fun loadStoredSchemaVersion(): Int? =
        connection.prepareStatement("SELECT schema_version FROM workbook_metadata WHERE singleton_key = 1")
            .use { statement ->
                statement.executeQuery().use { rs ->
                    if (rs.next()) rs.getInt("schema_version") else null
                }
            }

    private fun loadRows(sheetId: SheetId): List<RowId> =
        connection.prepareStatement(
            "SELECT row_id FROM sheet_rows WHERE sheet_id = ? ORDER BY row_order",
        ).use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) add(RowId(rs.getBytes("row_id").toUuidString()))
                }
            }
        }

    private fun loadColumns(sheetId: SheetId): List<ColumnId> =
        connection.prepareStatement(
            "SELECT column_id FROM sheet_columns WHERE sheet_id = ? ORDER BY column_order",
        ).use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) add(ColumnId(rs.getBytes("column_id").toUuidString()))
                }
            }
        }

    private fun loadCells(sheetId: SheetId): Map<CellCoordinate, String> =
        connection.prepareStatement(
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
}

private data class SheetRecord(
    val id: SheetId,
    val name: String,
    val revision: Long,
    val frame: FrameState,
)
