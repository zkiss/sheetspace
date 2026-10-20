package com.sheetspace

internal fun validModelColumnBindings(sheet: SheetDocument, models: Map<String, DataModel>): Boolean {
    val model = sheet.modelId?.let(models::get)
    if (sheet.modelId != null && model == null) return false
    val propertyIds = model?.columns?.map(ModelColumn::id)?.toSet().orEmpty()
    return sheet.modelColumnBindings.keys.all(propertyIds::contains) &&
        sheet.modelColumnBindings.values.all(sheet.tabularContent.columns::contains) &&
        sheet.modelColumnBindings.values.distinct().size == sheet.modelColumnBindings.size
}
