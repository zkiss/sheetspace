package com.sheetspace

import java.sql.Connection

/** Writes only the owning sparse presentation records in the caller's transaction. */
internal class SqlitePresentationWriter(private val connection: Connection) {
    fun apply(sheetId: SheetId, writes: List<AxisSizeWrite>) {
        writes.forEach { write ->
            val table = if (write.axis == "row") "row_presentation" else "column_presentation"
            val idColumn = if (write.axis == "row") "row_id" else "column_id"
            val sizeColumn = if (write.axis == "row") "height" else "width"
            val sql = if (write.size == null) "DELETE FROM $table WHERE sheet_id = ? AND $idColumn = ?"
            else "INSERT INTO $table (sheet_id, $idColumn, $sizeColumn) VALUES (?, ?, ?) ON CONFLICT(sheet_id, $idColumn) DO UPDATE SET $sizeColumn = excluded.$sizeColumn"
            connection.prepareStatement(sql).use { statement ->
                statement.setBytes(1, sheetId.value.toUuidBytes())
                statement.setBytes(2, write.axisId.toUuidBytes())
                if (write.size != null) statement.setDouble(3, write.size)
                statement.executeUpdate()
            }
        }
    }

    fun persistChanges(sheetId: SheetId, before: SheetPresentation, after: SheetPresentation) {
        val writes = changes("row", before.rowHeights, after.rowHeights) +
            changes("column", before.columnWidths, after.columnWidths)
        apply(sheetId, writes)
    }

    private fun changes(axis: String, before: Map<String, Double>, after: Map<String, Double>): List<AxisSizeWrite> =
        (before.keys + after.keys).mapNotNull { id ->
            if (before[id] == after[id]) null else AxisSizeWrite(axis, id, after[id])
        }
}
