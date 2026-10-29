package com.sheetspace

/** Persisted instances, not current positions, authorize surviving calculated cells. */
internal fun calculatedTransitionIsValid(current: WorkbookState, updated: WorkbookState): Boolean =
    calculatedTransitionIsValid(current, updated, LegacyCalculatedTemplates)

internal interface CalculatedTemplates<T> {
    fun templates(sheet: SheetDocument): Map<String, T>?
    fun valid(template: T, declaration: String): Boolean
    fun derive(template: T, workbook: WorkbookState, rowIndex: Int): String
}

private object LegacyCalculatedTemplates : CalculatedTemplates<BoundModelFormula> {
    override fun templates(sheet: SheetDocument) = sheet.modelFormulaBindings
    override fun valid(template: BoundModelFormula, declaration: String) = template.raw == declaration
    override fun derive(template: BoundModelFormula, workbook: WorkbookState, rowIndex: Int) = derivedFormulaRaw(template, workbook, rowIndex)
}

internal fun rejectCalculatedOverrides(current: WorkbookState, updated: WorkbookState) =
    rejectCalculatedOverrides(current, updated, LegacyCalculatedTemplates)

internal fun <T> calculatedTransitionIsValid(current: WorkbookState, updated: WorkbookState, rules: CalculatedTemplates<T>): Boolean =
    calculatedTemplatesAreValid(updated, rules) && calculatedOwnershipIsPreserved(current, updated) && updated.documents.values.all { sheet ->
        val model = sheet.modelId?.let(updated.dataModels::get) ?: return@all true
        model.columns.filterIsInstance<CalculatedModelColumn>().all propertyCheck@ { property ->
            val column = sheet.modelColumnBindings[property.id] ?: return@propertyCheck true
            val template = rules.templates(sheet).orEmpty().getValue(property.id)
            val previous = continuingCalculatedSheet(current, sheet, property, column)
            if (previous != null && rules.templates(previous).orEmpty()[property.id] != template) return@propertyCheck false
            sheet.tabularContent.rows.withIndex().all { (rowIndex, row) ->
                val coordinate = CellCoordinate(row, column)
                val expected = if (previous != null && row in previous.tabularContent.rows) {
                    previous.tabularContent.cellContents[coordinate]
                } else {
                    rules.derive(template, updated, rowIndex)
                }
                expected != null && sheet.tabularContent.cellContents[coordinate] == expected
            }
        }
    }

internal fun <T> calculatedTemplatesAreValid(workbook: WorkbookState, rules: CalculatedTemplates<T>): Boolean =
    workbook.documents.values.all { sheet ->
        val model = sheet.modelId?.let(workbook.dataModels::get) ?: return@all true
        val calculated = model.columns.filterIsInstance<CalculatedModelColumn>().filter { it.id in sheet.modelColumnBindings }
        val templates = rules.templates(sheet) ?: return@all calculated.isEmpty()
        templates.keys == calculated.map(ModelColumn::id).toSet() &&
            calculated.all { rules.valid(templates.getValue(it.id), it.formula) }
    }

internal fun preparedCalculatedTemplates(templates: (SheetDocument) -> Map<String, PreparedModelFormula>?) =
    object : CalculatedTemplates<PreparedModelFormula> {
        override fun templates(sheet: SheetDocument) = templates(sheet)
        override fun valid(template: PreparedModelFormula, declaration: String) = preparedModelTemplateIsValid(template, declaration)
        override fun derive(template: PreparedModelFormula, workbook: WorkbookState, rowIndex: Int) =
            derivedPreparedFormulaRaw(template, workbook, rowIndex)
    }

internal fun <T> retainDeclaredCalculatedTemplates(
    model: DataModel,
    templates: Map<String, T>?,
    matches: (T, String) -> Boolean,
): Map<String, T>? = templates?.filter { (propertyId, template) ->
    model.columns.any { it.id == propertyId && it is CalculatedModelColumn && matches(template, it.formula) }
}

internal fun <T> rejectCalculatedOverrides(current: WorkbookState, updated: WorkbookState, rules: CalculatedTemplates<T>) {
    if (!calculatedTransitionIsValid(current, updated, rules)) {
        throw WorkbookApplicationException(WorkbookApplicationError.CALCULATED_CELL_WRITE)
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
