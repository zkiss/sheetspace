package com.sheetspace

/** One expression and its provenance, shared with the frontend template transport. */
typealias PreparedModelFormula = BoundModelFormula

/** Declaration association is independent of the current existence of retained targets. */
internal fun preparedModelTemplateIsValid(template: PreparedModelFormula, declaration: String): Boolean = try {
    StoredFormulaCodec.decode(template.content).text == declaration
} catch (_: IllegalArgumentException) {
    false
}

internal fun derivedPreparedFormulaRaw(template: PreparedModelFormula, workbook: WorkbookState, rowIndex: Int): String =
    instantiateStoredModelFormula(template.content, rowIndex) { sheetId ->
        workbook.findSheet(SheetId(sheetId))?.tabularContent?.rows?.map { it.value }
    }
