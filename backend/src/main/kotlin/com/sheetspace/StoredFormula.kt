package com.sheetspace

internal data class OpaqueFormulaText(val start: Int, val end: Int, val text: String)

/** The stored value is the expression itself, never a source/provenance envelope. */
internal object StoredFormulaCodec {
    fun require(content: String): String {
        require(content.startsWith("=")) { "Invalid stored formula" }
        opaqueText(content)
        return content
    }

    fun escape(text: String): String = text.map { it.code.toString(16).padStart(4, '0') }.joinToString("", "~{", "}")

    fun opaqueText(content: String): List<OpaqueFormulaText> {
        val result = mutableListOf<OpaqueFormulaText>()
        var quoted = false
        var index = 0
        while (index < content.length) {
            if (content[index] == '"') {
                if (quoted && content.getOrNull(index + 1) == '"') index++ else quoted = !quoted
            } else if (!quoted && content.startsWith("~{", index)) {
                val end = content.indexOf('}', index + 2)
                require(end >= 0) { "Invalid stored formula" }
                val hex = content.substring(index + 2, end)
                require(Regex("(?:[0-9a-f]{4})+").matches(hex)) { "Invalid stored formula" }
                result.add(OpaqueFormulaText(index, end + 1, hex.chunked(4).map { it.toInt(16).toChar() }.joinToString("")))
                index = end
            }
            index++
        }
        return result
    }
}
