package com.sheetspace

typealias PreparedModelFormula = BoundModelFormula

internal fun preparedModelTemplateIsValid(template: PreparedModelFormula, declaration: String): Boolean = try {
    modelFormulaRecipes(template.content, declaration) != null
} catch (_: IllegalArgumentException) {
    false
}

internal fun derivedPreparedFormulaRaw(template: PreparedModelFormula, workbook: WorkbookState, rowIndex: Int, declaration: String, sheetId: String): String =
    instantiateStoredModelFormula(template.content, declaration, sheetId, rowIndex) { target ->
        workbook.findSheet(SheetId(target))?.tabularContent?.rows?.map { it.value }
    }
