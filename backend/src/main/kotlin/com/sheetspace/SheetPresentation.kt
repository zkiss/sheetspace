package com.sheetspace

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Sparse logical dimensions, independent of cells and workspace frames. */
@Serializable
data class SheetPresentation(
    val rowHeights: Map<String, Double> = emptyMap(),
    val columnWidths: Map<String, Double> = emptyMap(),
    val formatOverrides: SheetFormatOverrides = SheetFormatOverrides(),
)

@Serializable data class NumberFormat(val kind: String, val precision: Int? = null)
@Serializable data class CellFormat(
    val numberFormat: NumberFormat? = null,
    val fontWeight: String? = null,
    val horizontalAlignment: String? = null,
    val textColor: String? = null,
    val fillColor: String? = null,
)
@Serializable data class SheetFormatOverrides(
    val rows: Map<String, CellFormat> = emptyMap(),
    val columns: Map<String, CellFormat> = emptyMap(),
    val cells: Map<String, CellFormat> = emptyMap(),
)

@Serializable
data class AxisSizeWrite(val axis: String, val axisId: String, val size: Double?)
/** Each map entry is a present property: JSON null removes that property locally. */
@Serializable data class FormatWrite(
    val scope: String,
    val targetId: String,
    @SerialName("numberFormat") val numberFormat: NumberFormat? = null,
    val properties: Map<String, JsonElement> = mapOf("numberFormat" to (numberFormat?.let { format -> buildJsonObject { put("kind", format.kind); format.precision?.let { put("precision", it) } } } ?: JsonNull)),
)

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
    return sheet.presentation.copy(rowHeights = rows, columnWidths = columns)
}

fun validatedFormatWrites(sheet: SheetDocument, writes: List<FormatWrite>): SheetPresentation {
    if (writes.isEmpty() || writes.map { it.scope to it.targetId }.distinct().size != writes.size) invalidPresentation()
    writes.forEach { write ->
        val belongs = when (write.scope) {
            "row" -> sheet.tabularContent.rows.any { it.value == write.targetId }
            "column" -> sheet.tabularContent.columns.any { it.value == write.targetId }
            "cell" -> write.targetId.split("\u0000").let { ids -> ids.size == 2 && sheet.tabularContent.rows.any { it.value == ids[0] } && sheet.tabularContent.columns.any { it.value == ids[1] } }
            else -> false
        }
        if (!belongs || !validAppearancePatch(write.properties)) invalidPresentation()
    }
    val overrides = sheet.presentation.formatOverrides.let { SheetFormatOverrides(it.rows.toMutableMap(), it.columns.toMutableMap(), it.cells.toMutableMap()) }
    writes.forEach { write ->
        val target = when (write.scope) { "row" -> overrides.rows as MutableMap; "column" -> overrides.columns as MutableMap; else -> overrides.cells as MutableMap }
        val current = target[write.targetId] ?: CellFormat()
        val next = applyAppearancePatch(current, write.properties)
        if (next == CellFormat()) target.remove(write.targetId) else target[write.targetId] = next
    }
    return sheet.presentation.copy(formatOverrides = overrides)
}

private fun validAppearancePatch(properties: Map<String, JsonElement>): Boolean =
    properties.isNotEmpty() && properties.all { (key, value) ->
        value is JsonNull || when (key) {
            "numberFormat" -> value.toNumberFormatOrNull()?.let(::validNumberFormat) == true
            "fontWeight" -> value.stringOrNull() in setOf("normal", "bold")
            "horizontalAlignment" -> value.stringOrNull() in setOf("general", "left", "center", "right")
            "textColor" -> value.stringOrNull()?.let { color: String -> color == "automatic" || color.matches(Regex("#[0-9a-fA-F]{6}")) } == true
            "fillColor" -> value.stringOrNull()?.let { color: String -> color == "none" || color.matches(Regex("#[0-9a-fA-F]{6}")) } == true
            else -> false
        }
    }

private fun applyAppearancePatch(format: CellFormat, properties: Map<String, JsonElement>): CellFormat {
    fun string(name: String) = properties[name]?.let { if (it is JsonNull) null else it.stringOrNull() }
    val number = properties["numberFormat"]?.let { if (it is JsonNull) null else it.toNumberFormatOrNull() }
    return format.copy(
        numberFormat = if ("numberFormat" in properties) number else format.numberFormat,
        fontWeight = if ("fontWeight" in properties) string("fontWeight") else format.fontWeight,
        horizontalAlignment = if ("horizontalAlignment" in properties) string("horizontalAlignment") else format.horizontalAlignment,
        textColor = if ("textColor" in properties) string("textColor") else format.textColor,
        fillColor = if ("fillColor" in properties) string("fillColor") else format.fillColor,
    )
}

private fun JsonElement.stringOrNull(): String? = (this as? JsonPrimitive)?.content
private fun JsonElement.toNumberFormatOrNull(): NumberFormat? {
    val objectValue = this as? kotlinx.serialization.json.JsonObject ?: return null
    val kind = objectValue["kind"]?.stringOrNull() ?: return null
    val precision = objectValue["precision"]?.let { (it as? JsonPrimitive)?.content?.toIntOrNull() }
    return if (objectValue.keys == if (kind == "general") setOf("kind") else setOf("kind", "precision")) NumberFormat(kind, precision) else null
}

private fun validNumberFormat(format: NumberFormat): Boolean = when (format.kind) {
    "general" -> format.precision == null
    "number", "percent" -> format.precision != null && format.precision in 0..10
    else -> false
}

private fun invalidPresentation(): Nothing =
    throw WorkbookApplicationException(WorkbookApplicationError.INVALID_SHEET_PRESENTATION)
