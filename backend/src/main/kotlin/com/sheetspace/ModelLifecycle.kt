package com.sheetspace

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject

/** Compare complete semantic snapshots so stale structural writes cannot erase concurrent edits. */
internal fun reconcileModelLifecycle(current: WorkbookState, before: WorkbookState, after: WorkbookState): WorkbookState {
    validateLifecycleWorkbook(before)
    validateLifecycleWorkbook(after)
    requireLifecycle(before.manifest.sheetIds == after.manifest.sheetIds && before.dataModels.keys == after.dataModels.keys)
    if (sameWorkbookContent(current, after)) return current
    if (!sameWorkbookContent(current, before)) {
        throw WorkbookApplicationException(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT)
    }
    return after.copy(
        manifest = current.manifest,
        documents = after.documents.mapValues { (id, sheet) -> sheet.copy(revision = current.documents.getValue(id).revision) },
    )
}

private fun sameWorkbookContent(left: WorkbookState, right: WorkbookState): Boolean =
    left.copy(manifest = left.manifest.copy(revision = 0), documents = left.documents.mapValues { (_, sheet) -> sheet.copy(revision = 0) }) ==
        right.copy(manifest = right.manifest.copy(revision = 0), documents = right.documents.mapValues { (_, sheet) -> sheet.copy(revision = 0) })

private fun validateLifecycleWorkbook(workbook: WorkbookState) {
    requireLifecycle(workbook.manifest.version == WORKBOOK_SCHEMA_VERSION)
    requireLifecycle(workbook.documents.values.map { it.name.trim() }.distinct().size == workbook.documents.size)
    workbook.dataModels.values.forEach { model -> requireLifecycle(isValidDataModel(model)) }
    workbook.documents.values.forEach { sheet ->
        requireLifecycle(sheet.id.value.toUuidBytesOrNull() != null && sheet.name.isNotBlank())
        requireLifecycle(sheet.tabularContent.rows.all { it.value.toUuidBytesOrNull() != null } && sheet.tabularContent.columns.all { it.value.toUuidBytesOrNull() != null })
        requireLifecycle(sheet.frame.position.isValid() && sheet.frame.size.isValid() && isValidSheetVisualScale(sheet.frame.visualScale) && sheet.frame.zIndex >= 1)
        requireLifecycle(validModelColumnBindings(sheet, workbook.dataModels))
        val presentation = sheet.presentation
        val sizes = presentation.rowHeights.map { (id, size) -> AxisSizeWrite("row", id, size) } + presentation.columnWidths.map { (id, size) -> AxisSizeWrite("column", id, size) }
        if (sizes.isNotEmpty()) validatedPresentationWrites(sheet, sizes)
        val formats = presentation.formatOverrides
        val writes = formats.rows.map { (id, value) -> appearanceWrite("row", id, value) } + formats.columns.map { (id, value) -> appearanceWrite("column", id, value) } + formats.cells.map { (id, value) -> appearanceWrite("cell", id, value) }
        if (writes.isNotEmpty()) validatedFormatWrites(sheet, writes)
        sheet.modelFormulaBindings?.forEach { (propertyId, template) ->
            val property = workbook.dataModels[sheet.modelId]?.columns?.find { it.id == propertyId }
            requireLifecycle(property is CalculatedModelColumn && property.formula == template.raw)
            template.references.forEach { reference ->
                requireLifecycle(reference.sourceSpan.validIn(template.raw))
                reference.qualifierSpan?.let { requireLifecycle(it.validIn(template.raw)) }
                requireLifecycle(reference.endpoints.size in 1..2)
                reference.endpoints.filterNotNull().forEach { endpoint -> requireLifecycle(endpoint.sourceSpan.validIn(template.raw) && endpoint.rowIndex.isFinite() && endpoint.rowIndex >= 0 && endpoint.columnId.toUuidBytesOrNull() != null) }
            }
        }
    }
}

private fun ModelFormulaSpan.validIn(raw: String) = start >= 0 && end > start && end <= raw.length

private fun appearanceWrite(scope: String, id: String, value: CellFormat) = FormatWrite(scope, id, properties = Json.encodeToJsonElement(value).jsonObject)

private fun requireLifecycle(valid: Boolean) {
    if (!valid) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
}
