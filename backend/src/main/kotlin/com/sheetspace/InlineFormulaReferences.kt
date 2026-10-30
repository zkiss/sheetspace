package com.sheetspace

internal data class InlineFormulaEndpoint(val start: Int, val end: Int, val columnAnchor: Boolean, val rowAnchor: Boolean, val column: String, val row: String, val property: String? = null)
internal data class InlineFormulaReference(val start: Int, val end: Int, val qualifier: String?, val endpoints: List<InlineFormulaEndpoint>)

/** Small boundary scanner for declaration association, not a calculation parser. */
internal fun inlineFormulaReferences(text: String, stored: Boolean): List<InlineFormulaReference> {
    val result = mutableListOf<InlineFormulaReference>()
    val opaque = if (stored) StoredFormulaCodec.opaqueText(text) else emptyList()
    var index = 0
    var quoted = false
    while (index < text.length) {
        val raw = opaque.firstOrNull { it.start == index }
        if (raw != null) { index = raw.end; continue }
        if (text[index] == '"') {
            if (quoted && text.getOrNull(index + 1) == '"') index++ else quoted = !quoted
        } else if (!quoted && text[index] == '@') {
            val reference = readInlineReference(text, index, stored)
            if (reference != null) { result.add(reference); index = reference.end; continue }
        }
        index++
    }
    return result
}

private fun readInlineReference(text: String, start: Int, stored: Boolean): InlineFormulaReference? {
    var cursor = start + 1
    val qualifierMatch = Regex("(?:'((?:[^']|'')*)'|([A-Za-z0-9_:.\\-]+))!").find(text, cursor)?.takeIf { it.range.first == cursor }
    val qualifier = qualifierMatch?.let { it.groups[1]?.value?.replace("''", "'") ?: it.groupValues[2] }
    if (qualifierMatch != null) cursor = qualifierMatch.range.last + 1
    val first = readInlineEndpoint(text, cursor, stored) ?: return null
    cursor = first.end
    val after = text.substring(cursor).takeWhile(Char::isWhitespace).length + cursor
    val second = if (text.getOrNull(after) == ':') {
        cursor = after + 1
        while (text.getOrNull(cursor)?.isWhitespace() == true) cursor++
        readInlineEndpoint(text, cursor, stored) ?: return null
    } else null
    if (second != null) cursor = second.end
    if (stored && second != null && (first.property != null) != (second.property != null)) return null
    return InlineFormulaReference(start, cursor, qualifier, listOfNotNull(first, second))
}

private fun readInlineEndpoint(text: String, start: Int, stored: Boolean): InlineFormulaEndpoint? {
    val expression = if (stored) "(\\$?)(?:~([0-9a-f]+)~([0-9a-f]+)|([A-Za-z0-9_:\\-]+))\\[(\\$?)([A-Za-z0-9_:\\-]+)]"
        else "(\\$?)(?:'((?:[^']|'')*)'|([A-Za-z][A-Za-z0-9_]*))(?:\\[(\\$?)([1-9][0-9]*)])?"
    val match = Regex(expression).find(text, start)?.takeIf { it.range.first == start } ?: return null
    val groups = match.groupValues
    return if (stored) {
        val named = groups[2].isNotEmpty()
        fun decode(value: String): String? = if (value.length % 4 == 0 && value.isNotEmpty() && Regex("[0-9a-f]+").matches(value)) value.chunked(4).map { it.toInt(16).toChar() }.joinToString("") else null
        val column = if (named) decode(groups[3]) ?: return null else groups[4]
        val row = if (named) decode(groups[6]) ?: return null else groups[6]
        if (!named && Regex("[A-Za-z]+").matches(column)) return null
        InlineFormulaEndpoint(start, match.range.last + 1, groups[1].isNotEmpty(), groups[5].isNotEmpty(), column, row, if (named) decode(groups[2]) ?: return null else null)
    } else {
        if (groups[5].isNotEmpty() && (groups[5].toLongOrNull()?.let { it <= 9007199254740991L } != true)) return null
        InlineFormulaEndpoint(start, match.range.last + 1, groups[1].isNotEmpty(), groups[4].isNotEmpty(), groups[2].ifEmpty { groups[3] }, groups[5].ifEmpty { "1" }, if (groups[2].isNotEmpty() || groups[5].isEmpty()) groups[2].ifEmpty { groups[3] } else null)
    }
}
