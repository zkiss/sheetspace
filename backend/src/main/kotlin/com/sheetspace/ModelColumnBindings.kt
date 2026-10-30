package com.sheetspace

internal fun validModelColumnBindings(sheet: SheetDocument, models: Map<String, DataModel>): Boolean {
    val model = sheet.modelId?.let(models::get)
    if (sheet.modelId != null && model == null) return false
    val propertyIds = model?.columns?.map(ModelColumn::id)?.toSet().orEmpty()
    return sheet.modelColumnBindings.keys.all(propertyIds::contains) &&
        sheet.modelColumnBindings.values.all(sheet.tabularContent.columns::contains) &&
        sheet.modelColumnBindings.values.distinct().size == sheet.modelColumnBindings.size
}

/** Columns owned by declarations, never by their displayed text. */
internal fun calculatedModelColumns(sheet: SheetDocument, models: Map<String, DataModel>): Set<ColumnId> {
    val model = sheet.modelId?.let(models::get) ?: return emptySet()
    return model.columns.filterIsInstance<CalculatedModelColumn>()
        .mapNotNull { property -> sheet.modelColumnBindings[property.id] }.toSet()
}

internal fun calculatedTemplatesAreValid(workbook: WorkbookState): Boolean =
    calculatedTemplatesAreValid(workbook, StoredCalculatedTemplates)

/** Fresh-instantiation check only; historical contents require persisted transition authority. */
internal fun calculatedContentsAreDerived(workbook: WorkbookState): Boolean =
    calculatedTemplatesAreValid(workbook) && workbook.documents.values.all { sheet ->
        val model = sheet.modelId?.let(workbook.dataModels::get) ?: return@all true
        val calculated = model.columns.filterIsInstance<CalculatedModelColumn>().filter { it.id in sheet.modelColumnBindings }
        val templates = sheet.modelFormulaBindings ?: return@all true
        calculated.all { property ->
            val column = sheet.modelColumnBindings.getValue(property.id)
            val template = templates.getValue(property.id)
            sheet.tabularContent.rows.withIndex().all { (rowIndex, row) ->
                sheet.tabularContent.cellContents[CellCoordinate(row, column)] == derivedFormulaRaw(template, workbook, rowIndex, property.formula, sheet.id.value)
            }
        }
    }

internal fun calculatedOverridesWereIntroduced(current: WorkbookState, updated: WorkbookState): Boolean =
    !calculatedTransitionIsValid(current, updated)

internal fun derivedFormulaRaw(template: BoundModelFormula, workbook: WorkbookState, rowIndex: Int, declaration: String, sheetId: String): String =
    derivedPreparedFormulaRaw(template, workbook, rowIndex, declaration, sheetId)
