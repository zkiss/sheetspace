package com.sheetspace

internal fun validModelColumnBindings(sheet: SheetDocument, models: Map<String, DataModel>): Boolean {
    val model = sheet.modelId?.let(models::get)
    if (sheet.modelId != null && model == null) return false
    val propertyIds = model?.columns?.map(ModelColumn::id)?.toSet().orEmpty()
    return sheet.modelColumnBindings.keys.all(propertyIds::contains) &&
        sheet.modelColumnBindings.values.all(sheet.tabularContent.columns::contains) &&
        sheet.modelColumnBindings.values.distinct().size == sheet.modelColumnBindings.size
}

/** Columns owned by current calculated property declarations, never by their displayed raw text. */
internal fun calculatedModelColumns(sheet: SheetDocument, models: Map<String, DataModel>): Set<ColumnId> {
    val model = sheet.modelId?.let(models::get) ?: return emptySet()
    return model.columns.filterIsInstance<CalculatedModelColumn>()
        .mapNotNull { property -> sheet.modelColumnBindings[property.id] }
        .toSet()
}

internal fun isDerivedCalculatedWrite(workbook: WorkbookState, sheet: SheetDocument, write: SheetCellWrite): Boolean {
    val model = sheet.modelId?.let(workbook.dataModels::get) ?: return false
    val column = ColumnId(write.columnId)
    val property = model.columns.filterIsInstance<CalculatedModelColumn>()
        .firstOrNull { sheet.modelColumnBindings[it.id] == column } ?: return false
    val template = sheet.modelFormulaBindings?.get(property.id) ?: return false
    val rowIndex = sheet.tabularContent.rows.indexOf(RowId(write.rowId))
    return rowIndex >= 0 && template.raw == property.formula &&
        write.raw in setOf(template.raw, derivedFormulaRaw(template, sheet, rowIndex))
}

private fun derivedFormulaRaw(template: BoundModelFormula, sheet: SheetDocument, rowIndex: Int): String {
    val edits = template.references.flatMap { reference ->
        reference.endpoints.mapNotNull { endpoint -> endpoint?.let { value ->
            val row = sheet.tabularContent.rows.getOrNull(value.rowIndex.toInt() + if (value.anchors.row) 0 else rowIndex)
            row?.let { value.sourceSpan to "${if (value.anchors.column) "$" else ""}${value.columnId}[${if (value.anchors.row) "$" else ""}${it.value}]" }
        } }
    }
    return edits.sortedByDescending { it.first.start }.fold(template.raw) { raw, (span, value) ->
        raw.substring(0, span.start) + value + raw.substring(span.end)
    }
}
