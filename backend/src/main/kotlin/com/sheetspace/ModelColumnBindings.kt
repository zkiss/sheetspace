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

/**
 * Every bound calculated property must carry the template of its current declaration.
 *
 * Absent or stale template metadata is invalid, never authority: it must not turn a calculated
 * column into an unvalidated column.
 */
internal fun calculatedTemplatesAreValid(workbook: WorkbookState): Boolean = workbook.documents.values.all { sheet ->
    val model = sheet.modelId?.let(workbook.dataModels::get) ?: return@all true
    val calculated = model.columns.filterIsInstance<CalculatedModelColumn>()
        .filter { it.id in sheet.modelColumnBindings }
    val templates = sheet.modelFormulaBindings ?: return@all calculated.isEmpty()
    templates.keys == calculated.map(ModelColumn::id).toSet() &&
        calculated.all { property -> templates.getValue(property.id).raw == property.formula }
}

/** Every row of a bound calculated sheet carries the derived instance of its persisted template. */
internal fun calculatedContentsAreDerived(workbook: WorkbookState): Boolean =
    calculatedTemplatesAreValid(workbook) && workbook.documents.values.all { sheet ->
        val model = sheet.modelId?.let(workbook.dataModels::get) ?: return@all true
        val calculated = model.columns.filterIsInstance<CalculatedModelColumn>()
            .filter { it.id in sheet.modelColumnBindings }
        val templates = sheet.modelFormulaBindings ?: return@all true
        calculated.all { property ->
            val column = sheet.modelColumnBindings.getValue(property.id)
            val template = templates.getValue(property.id)
            sheet.tabularContent.rows.withIndex().all { (rowIndex, row) ->
                sheet.tabularContent.cellContents[CellCoordinate(row, column)] == derivedFormulaRaw(template, workbook, rowIndex)
            }
        }
    }

/**
 * True when the operation changed a calculated cell to content that is not the derived instance.
 *
 * Only the cells the operation changed are constrained. A cell the operation left alone keeps its
 * content even when a structural change elsewhere invalidated its derived instance, so an
 * unrelated operation never fails for a calculation it did not override.
 */
internal fun calculatedOverridesWereIntroduced(current: WorkbookState, updated: WorkbookState): Boolean =
    updated.documents.values.any { sheet -> sheetOverridesACalculation(current, updated, sheet) }

private fun sheetOverridesACalculation(current: WorkbookState, updated: WorkbookState, sheet: SheetDocument): Boolean {
    val model = sheet.modelId?.let(updated.dataModels::get) ?: return false
    val templates = sheet.modelFormulaBindings ?: return false
    val previous = current.documents[sheet.id]
    val calculated = model.columns.filterIsInstance<CalculatedModelColumn>()
        .filter { it.id in sheet.modelColumnBindings }
    return calculated.any { property ->
        propertyOverridesCalculation(previous, updated, sheet, property, templates[property.id])
    }
}

private fun propertyOverridesCalculation(
    previous: SheetDocument?,
    updated: WorkbookState,
    sheet: SheetDocument,
    property: CalculatedModelColumn,
    template: BoundModelFormula?,
): Boolean {
    if (template == null) return false
    val column = sheet.modelColumnBindings.getValue(property.id)
    return sheet.tabularContent.rows.withIndex().any { (rowIndex, row) ->
        val coordinate = CellCoordinate(row, column)
        val previousRaw = previous?.let { it.tabularContent.cellContents[coordinate] }
        val currentRaw = sheet.tabularContent.cellContents[coordinate]
        previousRaw != currentRaw && currentRaw != derivedFormulaRaw(template, updated, rowIndex)
    }
}

internal fun derivedFormulaRaw(template: BoundModelFormula, workbook: WorkbookState, rowIndex: Int): String {
    val edits = buildList {
        template.references.forEach { reference ->
            val target = reference.sheetId?.let { workbook.findSheet(SheetId(it)) }
            val values = reference.endpoints.map { endpoint ->
                endpoint?.let { value -> derivedEndpointText(target, value, workbook, rowIndex) }
            }
            if (target == null || values.any { it == null }) {
                add(reference.sourceSpan to "@#REF!A[1]")
            } else {
                reference.qualifierSpan?.let { add(it to target.id.value) }
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

/** Canonical text of one instantiated reference target, or null when that target does not resolve. */
private fun derivedEndpointText(
    target: SheetDocument?,
    endpoint: ModelFormulaEndpoint,
    workbook: WorkbookState,
    rowIndex: Int,
): String? {
    if (target == null) return null
    val validProperty = endpoint.propertyId?.let { propertyId ->
        target.modelColumnBindings[propertyId] == ColumnId(endpoint.columnId) &&
            workbook.dataModels[target.modelId]?.columns?.any { it.id == propertyId } == true
    } ?: true
    val row = integralRowIndex(endpoint.rowIndex)?.let { index ->
        target.tabularContent.rows.getOrNull(index + if (endpoint.anchors.row) 0 else rowIndex)
    }
    if (!validProperty || row == null || ColumnId(endpoint.columnId) !in target.tabularContent.columns) return null
    return canonicalEndpoint(endpoint, row.value)
}

/**
 * Canonical endpoint text of one instantiated reference target.
 *
 * The frontend stores property targets in their named canonical form and plain address targets in
 * their column form, so derived contents are only comparable when both sides use the same text.
 */
private fun canonicalEndpoint(endpoint: ModelFormulaEndpoint, row: String): String {
    val propertyId = endpoint.propertyId
        ?: return "${if (endpoint.anchors.column) "$" else ""}${endpoint.columnId}[${if (endpoint.anchors.row) "$" else ""}$row]"
    return "${if (endpoint.anchors.column) "$" else ""}~${encodeStableId(propertyId)}~${encodeStableId(endpoint.columnId)}" +
        "[${if (endpoint.anchors.row) "$" else ""}${encodeStableId(row)}]"
}

/** Stable identifiers encode UTF-16 code units as four hexadecimal digits each. */
private fun encodeStableId(value: String): String =
    value.map { it.code.toString(16).padStart(4, '0') }.joinToString("")

/** Only whole row indices address a row, so a fractional index leaves its reference unresolved. */
private fun integralRowIndex(value: Double): Int? {
    val index = value.toInt()
    return if (index.toDouble() == value) index else null
}
