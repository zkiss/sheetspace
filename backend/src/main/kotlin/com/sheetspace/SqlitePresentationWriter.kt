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
        applyFormats(sheetId, formatChanges(before.formatOverrides, after.formatOverrides))
    }

    fun applyFormats(sheetId: SheetId, writes: List<FormatWrite>) {
        writes.forEach { write ->
            val (table, idColumn) = when (write.scope) { "row" -> "row_format_presentation" to "row_id"; "column" -> "column_format_presentation" to "column_id"; else -> "cell_format_presentation" to "cell_key" }
            val sql = if (write.numberFormat == null) "DELETE FROM $table WHERE sheet_id = ? AND $idColumn = ?" else "INSERT INTO $table (sheet_id, $idColumn, format_kind, precision) VALUES (?, ?, ?, ?) ON CONFLICT(sheet_id, $idColumn) DO UPDATE SET format_kind = excluded.format_kind, precision = excluded.precision"
            connection.prepareStatement(sql).use { statement ->
                statement.setBytes(1, sheetId.value.toUuidBytes())
                if (write.scope == "cell") statement.setString(2, write.targetId) else statement.setBytes(2, write.targetId.toUuidBytes())
                if (write.numberFormat != null) { statement.setString(3, write.numberFormat.kind); if (write.numberFormat.precision == null) statement.setObject(4, null) else statement.setInt(4, write.numberFormat.precision) }
                statement.executeUpdate()
            }
        }
    }

    private fun changes(axis: String, before: Map<String, Double>, after: Map<String, Double>): List<AxisSizeWrite> =
        (before.keys + after.keys).mapNotNull { id ->
            if (before[id] == after[id]) null else AxisSizeWrite(axis, id, after[id])
        }

    private fun formatChanges(before: SheetFormatOverrides, after: SheetFormatOverrides): List<FormatWrite> =
        listOf("row" to before.rows to after.rows, "column" to before.columns to after.columns, "cell" to before.cells to after.cells).flatMap { (scopeBefore, afterMap) ->
            val (scope, beforeMap) = scopeBefore
            (beforeMap.keys + afterMap.keys).mapNotNull { id -> if (beforeMap[id] == afterMap[id]) null else FormatWrite(scope, id, afterMap[id]?.numberFormat) }
        }
}
