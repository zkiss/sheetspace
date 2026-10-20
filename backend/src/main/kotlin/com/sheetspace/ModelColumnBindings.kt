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
        write.raw == derivedFormulaRaw(template, workbook, rowIndex)
}

internal fun calculatedContentsAreDerived(
    workbook: WorkbookState,
    mayOmit: (SheetDocument, RowId) -> Boolean = { _, _ -> false },
    requireTemplates: Boolean = false,
): Boolean = workbook.documents.values.all { sheet ->
    val model = sheet.modelId?.let(workbook.dataModels::get) ?: return@all true
    val calculated = model.columns.filterIsInstance<CalculatedModelColumn>()
        .filter { it.id in sheet.modelColumnBindings }
    val templates = sheet.modelFormulaBindings ?: return@all (
        !requireTemplates || calculated.all { property ->
            val column = sheet.modelColumnBindings.getValue(property.id)
            sheet.tabularContent.rows.all { row -> CellCoordinate(row, column) !in sheet.tabularContent.cellContents }
        }
    )
    if (templates.keys != calculated.map(ModelColumn::id).toSet()) return@all false
    calculated.all { property ->
        val column = sheet.modelColumnBindings.getValue(property.id)
        val template = templates.getValue(property.id)
        template.raw == property.formula && sheet.tabularContent.rows.withIndex().all { (rowIndex, row) ->
            (mayOmit(sheet, row) && CellCoordinate(row, column) !in sheet.tabularContent.cellContents) ||
                sheet.tabularContent.cellContents[CellCoordinate(row, column)] == derivedFormulaRaw(template, workbook, rowIndex)
        }
    }
}

internal fun derivedFormulaRaw(template: BoundModelFormula, workbook: WorkbookState, rowIndex: Int): String {
    val edits = buildList {
        template.references.forEach { reference ->
            val sheet = reference.sheetId?.let { workbook.findSheet(SheetId(it)) }
            val values = reference.endpoints.map { endpoint -> endpoint?.let { value ->
                val validProperty = value.propertyId?.let { propertyId ->
                    sheet?.modelColumnBindings?.get(propertyId) == ColumnId(value.columnId) &&
                        workbook.dataModels[sheet.modelId]?.columns?.any { it.id == propertyId } == true
                } ?: true
                val row = sheet?.tabularContent?.rows?.getOrNull(value.rowIndex.toInt() + if (value.anchors.row) 0 else rowIndex)
                if (validProperty && row != null && ColumnId(value.columnId) in sheet.tabularContent.columns) {
                    "${if (value.anchors.column) "$" else ""}${value.columnId}[${if (value.anchors.row) "$" else ""}${row.value}]"
                } else null
            } }
            if (sheet == null || values.any { it == null }) {
                add(reference.sourceSpan to "@#REF!A[1]")
            } else {
                reference.qualifierSpan?.let { add(it to sheet.id.value) }
                reference.endpoints.forEachIndexed { index, endpoint ->
                    add(endpoint!!.sourceSpan to values[index]!!)
                }
            }
        }
    }
    return edits.sortedByDescending { it.first.start }.fold(template.raw) { raw, (span, value) ->
        raw.substring(0, span.start) + value + raw.substring(span.end)
    }
}
