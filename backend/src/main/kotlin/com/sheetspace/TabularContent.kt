package com.sheetspace

sealed interface SheetContent {
    val kind: SheetContentKind
}

enum class SheetContentKind {
    TABULAR,
}

data class TabularContent(
    val columnCount: Int = DEFAULT_COLUMN_COUNT,
    val rowCount: Int = DEFAULT_ROW_COUNT,
    val cells: Map<String, String> = emptyMap(),
) : SheetContent {
    override val kind: SheetContentKind = SheetContentKind.TABULAR

    fun containsCell(address: String): Boolean {
        val match = CELL_ADDRESS.matchEntire(address) ?: return false
        val column = match.groupValues[1].columnIndex() ?: return false
        val row = match.groupValues[2].toIntOrNull() ?: return false
        return row in 1..rowCount && column in 1..columnCount
    }

    fun updateCell(address: String, content: String): TabularContent {
        require(containsCell(address)) { "Cell address is outside tabular content: $address" }
        return copy(
            cells = if (content.isEmpty()) cells - address else cells + (address to content),
        )
    }

    fun appendRow(): TabularContent = copy(rowCount = rowCount + 1)

    fun appendColumn(): TabularContent = copy(columnCount = columnCount + 1)

    private fun String.columnIndex(): Int? {
        var result = 0
        for (char in this) {
            result = result * 26 + (char - 'A' + 1)
            if (result < 1) return null
        }
        return result
    }

    private companion object {
        val CELL_ADDRESS = Regex("^([A-Z]+)([1-9][0-9]*)$")
    }
}
