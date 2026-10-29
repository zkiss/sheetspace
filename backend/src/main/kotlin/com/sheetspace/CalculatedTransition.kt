package com.sheetspace

/** Persisted instances, not current positions, authorize surviving calculated cells. */
internal fun calculatedTransitionIsValid(current: WorkbookState, updated: WorkbookState): Boolean =
    calculatedTemplatesAreValid(updated) && calculatedOwnershipIsPreserved(current, updated) && updated.documents.values.all { sheet ->
        val model = sheet.modelId?.let(updated.dataModels::get) ?: return@all true
        model.columns.filterIsInstance<CalculatedModelColumn>().all propertyCheck@ { property ->
            val column = sheet.modelColumnBindings[property.id] ?: return@propertyCheck true
            val template = sheet.modelFormulaBindings.orEmpty().getValue(property.id)
            val previous = continuingCalculatedSheet(current, sheet, property, column)
            if (previous != null && previous.modelFormulaBindings.orEmpty()[property.id] != template) return@propertyCheck false
            sheet.tabularContent.rows.withIndex().all { (rowIndex, row) ->
                val coordinate = CellCoordinate(row, column)
                val expected = if (previous != null && row in previous.tabularContent.rows) {
                    previous.tabularContent.cellContents[coordinate]
                } else {
                    derivedFormulaRaw(template, updated, rowIndex)
                }
                expected != null && sheet.tabularContent.cellContents[coordinate] == expected
            }
        }
    }

private fun calculatedOwnershipIsPreserved(current: WorkbookState, updated: WorkbookState): Boolean =
    current.documents.values.all { previous ->
        val sheet = updated.documents[previous.id] ?: return@all true
        if (previous.modelId != sheet.modelId) return@all true
        val beforeModel = current.dataModels[previous.modelId] ?: return@all true
        val afterModel = updated.dataModels[sheet.modelId] ?: return@all true
        val calculatedIds = afterModel.columns.filterIsInstance<CalculatedModelColumn>().map { it.id }.toSet()
        beforeModel.columns.filterIsInstance<CalculatedModelColumn>().all propertyCheck@ { property ->
            val column = previous.modelColumnBindings[property.id] ?: return@propertyCheck true
            property.id !in calculatedIds || sheet.modelColumnBindings[property.id] == column
        }
    }

private fun continuingCalculatedSheet(
    current: WorkbookState,
    sheet: SheetDocument,
    property: CalculatedModelColumn,
    column: ColumnId,
): SheetDocument? {
    val previous = current.documents[sheet.id] ?: return null
    if (previous.modelId != sheet.modelId || previous.modelColumnBindings[property.id] != column) return null
    val model = current.dataModels[sheet.modelId] ?: return null
    val declaration = model.columns.find { it.id == property.id }
    return if (declaration is CalculatedModelColumn && declaration.formula == property.formula) previous else null
}
