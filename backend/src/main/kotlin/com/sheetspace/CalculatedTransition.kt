package com.sheetspace

/** Persisted instances, not current positions, authorize surviving calculated cells. */
internal fun calculatedTransitionIsValid(current: WorkbookState, updated: WorkbookState): Boolean =
    calculatedTransitionIsValid(current, updated, StoredCalculatedTemplates)

internal interface CalculatedTemplates<T> {
    fun templates(sheet: SheetDocument): Map<String, T>?
    fun valid(template: T, declaration: String): Boolean
    fun derive(template: T, workbook: WorkbookState, rowIndex: Int, declaration: String, sheetId: String): String
    fun content(template: T): String
}

internal object StoredCalculatedTemplates : CalculatedTemplates<BoundModelFormula> {
    override fun content(template: BoundModelFormula) = template.content
    override fun templates(sheet: SheetDocument) = sheet.modelFormulaBindings
    override fun valid(template: BoundModelFormula, declaration: String) = preparedModelTemplateIsValid(template, declaration)
    override fun derive(template: BoundModelFormula, workbook: WorkbookState, rowIndex: Int, declaration: String, sheetId: String) = derivedFormulaRaw(template, workbook, rowIndex, declaration, sheetId)
}

internal fun rejectCalculatedOverrides(current: WorkbookState, updated: WorkbookState) =
    rejectCalculatedOverrides(current, updated, StoredCalculatedTemplates)

internal fun <T> calculatedTransitionIsValid(current: WorkbookState, updated: WorkbookState, rules: CalculatedTemplates<T>): Boolean =
    calculatedTemplatesAreValid(updated, rules) && calculatedOwnershipIsPreserved(current, updated) && updated.documents.values.all { sheet ->
        val model = sheet.modelId?.let(updated.dataModels::get) ?: return@all true
        model.columns.filterIsInstance<CalculatedModelColumn>().all propertyCheck@ { property ->
            val column = sheet.modelColumnBindings[property.id] ?: return@propertyCheck true
            val template = rules.templates(sheet).orEmpty().getValue(property.id)
            val previous = continuingCalculatedSheet(current, updated, sheet, property, column, template, rules)
            if (previous != null && rules.templates(previous).orEmpty()[property.id] != template) return@propertyCheck false
            sheet.tabularContent.rows.withIndex().all { (rowIndex, row) ->
                val coordinate = CellCoordinate(row, column)
                val expected = if (previous != null && row in previous.tabularContent.rows) {
                    previous.tabularContent.cellContents[coordinate]
                } else {
                    rules.derive(template, updated, rowIndex, property.formula, sheet.id.value)
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
        override fun content(template: PreparedModelFormula) = template.content
        override fun templates(sheet: SheetDocument) = templates(sheet)
        override fun valid(template: PreparedModelFormula, declaration: String) = preparedModelTemplateIsValid(template, declaration)
        override fun derive(template: PreparedModelFormula, workbook: WorkbookState, rowIndex: Int, declaration: String, sheetId: String) =
            derivedPreparedFormulaRaw(template, workbook, rowIndex, declaration, sheetId)
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

private fun <T> continuingCalculatedSheet(
    current: WorkbookState,
    updated: WorkbookState,
    sheet: SheetDocument,
    property: CalculatedModelColumn,
    column: ColumnId,
    template: T,
    rules: CalculatedTemplates<T>,
): SheetDocument? {
    val previous = current.documents[sheet.id] ?: return null
    if (previous.modelId != sheet.modelId || previous.modelColumnBindings[property.id] != column) return null
    val model = current.dataModels[sheet.modelId] ?: return null
    val declaration = model.columns.find { it.id == property.id }
    if (declaration !is CalculatedModelColumn) return null
    return if (declaration.formula == property.formula || projectedDeclaration(current, updated, sheet, rules.content(template), declaration.formula, property.formula)) previous else null
}

private fun projectedDeclaration(before: WorkbookState, after: WorkbookState, sheet: SheetDocument, content: String, old: String, new: String): Boolean {
    val oldRecipes = modelFormulaRecipes(content, old) ?: return false
    val newRecipes = modelFormulaRecipes(content, new) ?: return false
    if (oldRecipes.size != newRecipes.size) return false
    var reconstructed = new
    val edits = mutableListOf<Triple<Int, Int, String>>()
    for ((oldRecipe, newRecipe) in oldRecipes.zip(newRecipes)) {
        val targetId = SheetId(oldRecipe.stored.qualifier ?: sheet.id.value)
        val oldSheet = before.documents[targetId] ?: return false
        val newSheet = after.documents[targetId] ?: return false
        for ((index, oldEndpoint) in oldRecipe.declaration.endpoints.withIndex()) {
            val newEndpoint = newRecipe.declaration.endpoints.getOrNull(index) ?: return false
            if (oldEndpoint.column == newEndpoint.column) continue
            val target = oldRecipe.stored.endpoints[index]
            val identity = target.property ?: return false
            fun name(workbook: WorkbookState, document: SheetDocument): String? {
                val property = document.modelId?.let(workbook.dataModels::get)?.columns?.find { it.id == identity }
                return if (property != null && document.modelColumnBindings[identity]?.value == target.column) property.name
                else if (identity == target.column) document.columnNames[target.column] else null
            }
            if (name(before, oldSheet) != oldEndpoint.column || name(after, newSheet) != newEndpoint.column) return false
            fun columnEnd(text: String, endpoint: InlineFormulaEndpoint): Int {
                val start = endpoint.start + if (endpoint.columnAnchor) 1 else 0
                if (text[start] != '\'') return start + endpoint.column.length
                var cursor = start + 1
                while (cursor < text.length) {
                    if (text[cursor++] == '\'') {
                        if (text.getOrNull(cursor) != '\'') return cursor
                        cursor++
                    }
                }
                return cursor
            }
            val oldStart = oldEndpoint.start + if (oldEndpoint.columnAnchor) 1 else 0
            val newStart = newEndpoint.start + if (newEndpoint.columnAnchor) 1 else 0
            edits.add(Triple(newStart, columnEnd(new, newEndpoint), old.substring(oldStart, columnEnd(old, oldEndpoint))))
        }
    }
    edits.sortedByDescending { it.first }.forEach { (start, end, replacement) -> reconstructed = reconstructed.substring(0, start) + replacement + reconstructed.substring(end) }
    return reconstructed == old
}
