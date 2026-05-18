package com.sheetspace

import kotlinx.serialization.Serializable

const val WORKBOOK_SCHEMA_VERSION = 1
const val DEFAULT_COLUMN_COUNT = 10
const val DEFAULT_ROW_COUNT = 20
const val DEFAULT_SHEET_FRAME_WIDTH = 240.0
const val DEFAULT_SHEET_FRAME_HEIGHT = 160.0

@Serializable
data class Workbook(
    val version: Int = WORKBOOK_SCHEMA_VERSION,
    val sheets: List<Sheet> = emptyList(),
)

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
    val cells: Map<String, CellContent> = emptyMap(),
)

@Serializable
data class WorkspacePosition(
    val x: Double = 0.0,
    val y: Double = 0.0,
)

@Serializable
data class SheetFrameSize(
    val width: Double = DEFAULT_SHEET_FRAME_WIDTH,
    val height: Double = DEFAULT_SHEET_FRAME_HEIGHT,
)

@Serializable
data class CellContent(
    val raw: String,
)

fun emptyWorkbook(): Workbook = Workbook()

fun createSheet(
    id: String,
    name: String,
    existingSheets: List<Sheet> = emptyList(),
    position: WorkspacePosition = WorkspacePosition(),
    frameSize: SheetFrameSize = SheetFrameSize(),
    zIndex: Int? = null,
): SheetNameResult<Sheet> {
    return when (val validation = validateSheetName(name, existingSheets)) {
        is SheetNameResult.Invalid -> validation
        is SheetNameResult.Valid -> SheetNameResult.Valid(
            Sheet(
                id = id,
                name = validation.value,
                position = position,
                frameSize = frameSize,
                zIndex = zIndex ?: nextSheetZIndex(existingSheets),
            ),
        )
    }
}

private fun nextSheetZIndex(sheets: List<Sheet>): Int {
    return (sheets.maxOfOrNull { it.zIndex } ?: 0) + 1
}

fun validateSheetName(
    name: String,
    existingSheets: List<Sheet>,
    currentSheetId: String? = null,
): SheetNameResult<String> {
    val trimmedName = name.trim()
    if (trimmedName.isEmpty()) {
        return SheetNameResult.Invalid(SheetNameError.EMPTY)
    }

    val duplicate = existingSheets.any { sheet ->
        sheet.id != currentSheetId && sheet.name == trimmedName
    }
    if (duplicate) {
        return SheetNameResult.Invalid(SheetNameError.DUPLICATE)
    }

    return SheetNameResult.Valid(trimmedName)
}

fun renameSheet(workbook: Workbook, sheetId: String, nextName: String): WorkbookResult {
    return when (val validation = validateSheetName(nextName, workbook.sheets, sheetId)) {
        is SheetNameResult.Invalid -> WorkbookResult.InvalidName(validation.reason)
        is SheetNameResult.Valid -> {
            if (workbook.sheets.none { it.id == sheetId }) {
                WorkbookResult.UnknownSheet
            } else {
                WorkbookResult.Valid(
                    workbook.copy(
                        sheets = workbook.sheets.map { sheet ->
                            if (sheet.id == sheetId) sheet.copy(name = validation.value) else sheet
                        },
                    ),
                )
            }
        }
    }
}

fun appendRow(sheet: Sheet): Sheet = sheet.copy(rowCount = sheet.rowCount + 1)

fun appendColumn(sheet: Sheet): Sheet = sheet.copy(columnCount = sheet.columnCount + 1)

sealed class SheetNameResult<out T> {
    data class Valid<T>(val value: T) : SheetNameResult<T>()
    data class Invalid(val reason: SheetNameError) : SheetNameResult<Nothing>()
}

enum class SheetNameError {
    EMPTY,
    DUPLICATE,
}

sealed class WorkbookResult {
    data class Valid(val workbook: Workbook) : WorkbookResult()
    data class InvalidName(val reason: SheetNameError) : WorkbookResult()
    data object UnknownSheet : WorkbookResult()
}
