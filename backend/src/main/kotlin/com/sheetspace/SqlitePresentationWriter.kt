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
        applyFormatChanges(sheetId, before.formatOverrides, after.formatOverrides)
    }

    fun applyFormats(sheetId: SheetId, writes: List<FormatWrite>) {
        error("Appearance writes must be applied through validated presentation changes")
    }

    private fun applyFormatChanges(sheetId: SheetId, before: SheetFormatOverrides, after: SheetFormatOverrides) {
        listOf("row" to before.rows to after.rows, "column" to before.columns to after.columns, "cell" to before.cells to after.cells).forEach { (scopeBefore, afterMap) ->
            val (scope, beforeMap) = scopeBefore
            (beforeMap.keys + afterMap.keys).forEach { id ->
                if (beforeMap[id] != afterMap[id]) applyFormat(sheetId, scope, id, afterMap[id])
            }
        }
    }

    private fun applyFormat(sheetId: SheetId, scope: String, targetId: String, after: CellFormat?) {
            val (table, idColumn) = when (scope) { "row" -> "row_format_presentation" to "row_id"; "column" -> "column_format_presentation" to "column_id"; else -> "cell_format_presentation" to "cell_key" }
            val sql = if (after == null || after == CellFormat()) "DELETE FROM $table WHERE sheet_id = ? AND $idColumn = ?" else "INSERT INTO $table (sheet_id, $idColumn, format_kind, precision, font_weight, horizontal_alignment, text_color, fill_color) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sheet_id, $idColumn) DO UPDATE SET format_kind = excluded.format_kind, precision = excluded.precision, font_weight = excluded.font_weight, horizontal_alignment = excluded.horizontal_alignment, text_color = excluded.text_color, fill_color = excluded.fill_color"
            connection.prepareStatement(sql).use { statement ->
                statement.setBytes(1, sheetId.value.toUuidBytes())
                if (scope == "cell") statement.setString(2, targetId) else statement.setBytes(2, targetId.toUuidBytes())
                if (after != null && after != CellFormat()) { statement.setString(3, after.numberFormat?.kind); statement.setObject(4, after.numberFormat?.precision); statement.setString(5, after.fontWeight); statement.setString(6, after.horizontalAlignment); statement.setString(7, after.textColor); statement.setString(8, after.fillColor) }
                statement.executeUpdate()
            }
    }

    private fun changes(axis: String, before: Map<String, Double>, after: Map<String, Double>): List<AxisSizeWrite> =
        (before.keys + after.keys).mapNotNull { id ->
            if (before[id] == after[id]) null else AxisSizeWrite(axis, id, after[id])
        }

}
