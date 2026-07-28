package com.sheetspace

import java.util.UUID

sealed interface SheetContent {
    val kind: SheetContentKind
}

enum class SheetContentKind {
    TABULAR,
}

@JvmInline
value class RowId(val value: String) {
    companion object {
        fun generate(): RowId = RowId(UUID.randomUUID().toString())
    }
}

@JvmInline
value class ColumnId(val value: String) {
    companion object {
        fun generate(): ColumnId = ColumnId(UUID.randomUUID().toString())
    }
}

data class CellCoordinate(
    val rowId: RowId,
    val columnId: ColumnId,
)

class TabularContent private constructor(
    initialState: InitialTabularState,
) : SheetContent {
    val rows: List<RowId> = initialState.rows
    val columns: List<ColumnId> = initialState.columns
    val cellContents: Map<CellCoordinate, String> = initialState.cellContents

    constructor(
        columnCount: Int = DEFAULT_COLUMN_COUNT,
        rowCount: Int = DEFAULT_ROW_COUNT,
        cells: Map<String, String> = emptyMap(),
    ) : this(initialStateFromAddresses(columnCount, rowCount, cells))

    constructor(
        rows: List<RowId>,
        columns: List<ColumnId>,
        cellContents: Map<CellCoordinate, String>,
    ) : this(validateState(rows, columns, cellContents))

    override val kind: SheetContentKind = SheetContentKind.TABULAR

    val rowCount: Int
        get() = rows.size

    val columnCount: Int
        get() = columns.size

    /**
     * Compatibility A1 view for current API and application callers.
     *
     * Durable cell identity lives in [cellContents]; addresses are derived from
     * current row and column order.
     */
    val cells: Map<String, String>
        get() = cellContents.mapKeys { (coordinate, _) ->
            addressOf(coordinate)
                ?: error("Cell coordinate does not belong to this tabular content: $coordinate")
        }

    fun containsCell(address: String): Boolean = coordinateAt(address) != null

    fun coordinateAt(address: String): CellCoordinate? {
        val match = CELL_ADDRESS.matchEntire(address) ?: return null
        val columnIndex = match.groupValues[1].columnIndex() ?: return null
        val rowIndex = match.groupValues[2].toIntOrNull() ?: return null
        val rowId = rows.getOrNull(rowIndex - 1) ?: return null
        val columnId = columns.getOrNull(columnIndex - 1) ?: return null
        return CellCoordinate(rowId, columnId)
    }

    fun addressOf(coordinate: CellCoordinate): String? {
        val rowIndex = rows.indexOf(coordinate.rowId)
        val columnIndex = columns.indexOf(coordinate.columnId)
        if (rowIndex < 0 || columnIndex < 0) return null
        return "${columnLabel(columnIndex + 1)}${rowIndex + 1}"
    }

    fun updateCell(address: String, content: String): TabularContent {
        val coordinate = coordinateAt(address)
        requireNotNull(coordinate) { "Cell address is outside tabular content: $address" }
        val updatedContents = if (content.isEmpty()) {
            cellContents - coordinate
        } else {
            cellContents + (coordinate to content)
        }
        return TabularContent(rows, columns, updatedContents)
    }

    fun appendRow(): TabularContent =
        TabularContent(rows + RowId.generate(), columns, cellContents)

    fun appendColumn(): TabularContent =
        TabularContent(rows, columns + ColumnId.generate(), cellContents)

    /**
     * Compatibility copy for callers that still express tabular state through
     * dimensions and A1 content.
     */
    fun copy(
        columnCount: Int = this.columnCount,
        rowCount: Int = this.rowCount,
        cells: Map<String, String> = this.cells,
    ): TabularContent {
        require(columnCount >= 0) { "Column count cannot be negative" }
        require(rowCount >= 0) { "Row count cannot be negative" }
        val resizedRows = rows.resize(rowCount, RowId::generate)
        val resizedColumns = columns.resize(columnCount, ColumnId::generate)
        return fromAddresses(resizedRows, resizedColumns, cells)
    }

    override fun equals(other: Any?): Boolean =
        other is TabularContent &&
            rows == other.rows &&
            columns == other.columns &&
            cellContents == other.cellContents

    override fun hashCode(): Int {
        var result = rows.hashCode()
        result = 31 * result + columns.hashCode()
        result = 31 * result + cellContents.hashCode()
        return result
    }

    override fun toString(): String =
        "TabularContent(rows=$rows, columns=$columns, cellContents=$cellContents)"

    private fun String.columnIndex(): Int? {
        var result = 0
        for (char in this) {
            val next = result.toLong() * 26 + (char - 'A' + 1)
            if (char !in 'A'..'Z' || next > Int.MAX_VALUE) return null
            result = next.toInt()
        }
        return result.takeIf { it > 0 }
    }

    private companion object {
        val CELL_ADDRESS = Regex("^([A-Z]+)([1-9][0-9]*)$")

        fun initialStateFromAddresses(
            columnCount: Int,
            rowCount: Int,
            cells: Map<String, String>,
        ): InitialTabularState {
            require(columnCount >= 0) { "Column count cannot be negative" }
            require(rowCount >= 0) { "Row count cannot be negative" }
            return fromAddresses(
                rows = List(rowCount) { RowId.generate() },
                columns = List(columnCount) { ColumnId.generate() },
                cells = cells,
            ).let { InitialTabularState(it.rows, it.columns, it.cellContents) }
        }

        fun fromAddresses(
            rows: List<RowId>,
            columns: List<ColumnId>,
            cells: Map<String, String>,
        ): TabularContent {
            val empty = TabularContent(rows, columns, emptyMap())
            val contents = cells.mapKeys { (address, _) ->
                requireNotNull(empty.coordinateAt(address)) {
                    "Cell address is outside tabular content: $address"
                }
            }
            return TabularContent(rows, columns, contents)
        }

        fun validateState(
            rows: List<RowId>,
            columns: List<ColumnId>,
            cellContents: Map<CellCoordinate, String>,
        ): InitialTabularState {
            require(rows.distinct().size == rows.size) { "Tabular row ids must be unique" }
            require(columns.distinct().size == columns.size) { "Tabular column ids must be unique" }
            val rowIds = rows.toSet()
            val columnIds = columns.toSet()
            require(cellContents.keys.all { it.rowId in rowIds && it.columnId in columnIds }) {
                "Cell coordinates must belong to this tabular content"
            }
            return InitialTabularState(rows.toList(), columns.toList(), cellContents.toMap())
        }

        fun columnLabel(oneBasedIndex: Int): String {
            require(oneBasedIndex > 0)
            var index = oneBasedIndex
            return buildString {
                while (index > 0) {
                    index--
                    append('A' + (index % 26))
                    index /= 26
                }
            }.reversed()
        }

        fun <T> List<T>.resize(size: Int, generate: () -> T): List<T> =
            when {
                size <= this.size -> take(size)
                else -> this + List(size - this.size) { generate() }
            }
    }
}

private data class InitialTabularState(
    val rows: List<RowId>,
    val columns: List<ColumnId>,
    val cellContents: Map<CellCoordinate, String>,
)
