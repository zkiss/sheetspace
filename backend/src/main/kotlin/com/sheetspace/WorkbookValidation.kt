package com.sheetspace

internal fun WorkspacePosition.isValidWorkspacePosition(): Boolean =
    x.isFinite() && y.isFinite()

internal fun SheetFrameSize.isValidSheetFrameSize(): Boolean =
    width.isFinite() && height.isFinite() && width > 0.0 && height > 0.0

internal fun Int?.isValidSheetZIndex(): Boolean =
    this == null || this >= 1

internal fun Sheet.containsCell(address: String): Boolean {
    val match = Regex("^([A-Z]+)([1-9][0-9]*)$").matchEntire(address) ?: return false
    val column = match.groupValues[1].columnIndex() ?: return false
    val row = match.groupValues[2].toIntOrNull() ?: return false
    return row in 1..rowCount && column in 1..columnCount
}

private fun String.columnIndex(): Int? {
    var result = 0
    for (char in this) {
        result = result * 26 + (char - 'A' + 1)
        if (result < 1) return null
    }
    return result
}
