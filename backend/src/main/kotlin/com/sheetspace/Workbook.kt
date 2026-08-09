package com.sheetspace

import kotlinx.serialization.Serializable

const val WORKBOOK_SCHEMA_VERSION = 1
const val DEFAULT_COLUMN_COUNT = 10
const val DEFAULT_ROW_COUNT = 20
const val DEFAULT_SHEET_FRAME_WIDTH = 240.0
const val DEFAULT_SHEET_FRAME_HEIGHT = 160.0

/**
 * Compatibility response model for the current frontend contract.
 *
 * Removed by sheetspace-z5q.8 when the frontend adopts WorkbookManifest and
 * SheetDocument projections.
 */
@Serializable
data class Workbook(
    val version: Int = WORKBOOK_SCHEMA_VERSION,
    val sheets: List<Sheet> = emptyList(),
)

/**
 * Compatibility response model for the current flat sheet JSON contract.
 *
 * Production application and persistence code must use SheetDocument instead.
 * Removed by sheetspace-z5q.8.
 */
@Serializable
data class Sheet(
    val id: String,
    val name: String,
    val revision: Long = 0,
    val position: WorkspacePosition = WorkspacePosition(),
    val frameSize: SheetFrameSize = SheetFrameSize(),
    val zIndex: Int = 1,
    val columnCount: Int = DEFAULT_COLUMN_COUNT,
    val rowCount: Int = DEFAULT_ROW_COUNT,
    val cells: Map<String, String> = emptyMap(),
)

fun emptyWorkbook(): Workbook = Workbook()

internal object LegacyFlatSheetTransportAdapter {
    fun toTransport(document: SheetDocument): Sheet {
        val tabular = document.tabularContent
        return Sheet(
            id = document.id.value,
            name = document.name,
            revision = document.revision,
            position = document.frame.position,
            frameSize = document.frame.size,
            zIndex = document.frame.zIndex,
            columnCount = tabular.columnCount,
            rowCount = tabular.rowCount,
            cells = tabular.cells,
        )
    }
}
