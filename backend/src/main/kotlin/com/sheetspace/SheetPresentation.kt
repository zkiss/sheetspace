package com.sheetspace

import kotlinx.serialization.Serializable

/** Sparse logical dimensions, independent of cells and workspace frames. */
@Serializable
data class SheetPresentation(
    val rowHeights: Map<String, Double> = emptyMap(),
    val columnWidths: Map<String, Double> = emptyMap(),
)

@Serializable
data class AxisSizeWrite(val axis: String, val axisId: String, val size: Double?)

object AxisSizePolicy {
    const val DEFAULT_COLUMN_WIDTH = 76.0
    const val DEFAULT_ROW_HEIGHT = 26.4
    const val MIN_ROW_HEIGHT = 16.0
    const val MAX_ROW_HEIGHT = 1000.0
    const val MIN_COLUMN_WIDTH = 24.0
    const val MAX_COLUMN_WIDTH = 2000.0

    fun validSize(axis: String, size: Double): Boolean = size.isFinite() && when (axis) {
        "row" -> size in MIN_ROW_HEIGHT..MAX_ROW_HEIGHT
        "column" -> size in MIN_COLUMN_WIDTH..MAX_COLUMN_WIDTH
        else -> false
    }
}

fun validatedPresentationWrites(sheet: SheetDocument, writes: List<AxisSizeWrite>): SheetPresentation {
    if (writes.isEmpty() || writes.map { it.axis to it.axisId }.distinct().size != writes.size) invalidPresentation()
    writes.forEach { write ->
        val belongs = when (write.axis) {
            "row" -> sheet.tabularContent.rows.any { it.value == write.axisId }
            "column" -> sheet.tabularContent.columns.any { it.value == write.axisId }
            else -> false
        }
        if (!belongs || (write.size != null && !AxisSizePolicy.validSize(write.axis, write.size))) invalidPresentation()
    }
    val rows = sheet.presentation.rowHeights.toMutableMap()
    val columns = sheet.presentation.columnWidths.toMutableMap()
    writes.forEach { write ->
        val overrides = if (write.axis == "row") rows else columns
        if (write.size == null) overrides.remove(write.axisId) else overrides[write.axisId] = write.size
    }
    return SheetPresentation(rows, columns)
}

private fun invalidPresentation(): Nothing =
    throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_PRESENTATION)
