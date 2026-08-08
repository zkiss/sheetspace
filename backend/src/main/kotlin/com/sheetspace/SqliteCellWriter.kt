package com.sheetspace

import java.sql.Connection
import java.sql.PreparedStatement

/** Owns prepared sparse-cell mutations; caller owns aggregate revision checks and transaction. */
internal class SqliteCellWriter(
    private val connection: Connection,
) {
    fun replace(sheetId: SheetId, cells: Map<CellCoordinate, String>) {
        apply(sheetId, cells.map { (coordinate, raw) -> CellWrite(coordinate, raw) })
    }

    fun apply(sheetId: SheetId, writes: List<CellWrite>) {
        connection.prepareStatement(
            "DELETE FROM cells WHERE sheet_id = ? AND row_id = ? AND column_id = ?",
        ).use { statement ->
            writes.filter { it.content.isEmpty() }.forEach { write ->
                statement.bindCell(sheetId, write.coordinate)
                statement.addBatch()
            }
            statement.executeBatch()
        }
        connection.prepareStatement(
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

    private fun PreparedStatement.bindCell(sheetId: SheetId, coordinate: CellCoordinate) {
        setBytes(1, sheetId.value.toUuidBytes())
        setBytes(2, coordinate.rowId.value.toUuidBytes())
        setBytes(3, coordinate.columnId.value.toUuidBytes())
    }
}
