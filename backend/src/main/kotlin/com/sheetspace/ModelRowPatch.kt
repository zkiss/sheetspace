package com.sheetspace

import kotlinx.serialization.Serializable

@Serializable
data class SheetFormulaBindingWrite(val sheetId: String, val bindings: Map<String, BoundModelFormula>)

/** Lifecycle-only command; it is deliberately not part of the ordinary cell PATCH contract. */
internal data class ModelRowPatchCommand(
    val expectedRevisions: List<ExpectedSheetRevision>,
    val cells: List<SheetCellWrite>,
    val modelFormulaBindings: List<SheetFormulaBindingWrite>,
)

/** Calculated row contents and their stable template targets share one revision-checked transaction. */
internal fun applyModelRowPatch(current: WorkbookState, command: ModelRowPatchCommand): WorkbookState {
    if (command.cells.isEmpty() && command.modelFormulaBindings.isEmpty()) {
        throw WorkbookApplicationException(WorkbookApplicationError.EMPTY_CELL_PATCH)
    }
    if (command.modelFormulaBindings.map(SheetFormulaBindingWrite::sheetId).distinct().size != command.modelFormulaBindings.size) {
        throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_PATCH)
    }
    command.expectedRevisions.forEach { expected ->
        val sheet = current.findSheet(SheetId(expected.sheetId))
            ?: throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND)
        if (sheet.revision != expected.revision) throw SheetRevisionConflict(expected.sheetId, expected.revision, sheet.revision)
    }
    val writesBySheet = command.cells.groupBy { SheetId(it.sheetId) }
    val bindingsBySheet = command.modelFormulaBindings.associateBy { SheetId(it.sheetId) }
    val updated = current.copy(documents = current.documents.mapValues { (id, sheet) ->
        val content = sheet.tabularContent
        val cells = content.cellContents.toMutableMap()
        writesBySheet[id].orEmpty().forEach { write ->
            val coordinate = CellCoordinate(RowId(write.rowId), ColumnId(write.columnId))
            if (coordinate.rowId !in content.rows || coordinate.columnId !in content.columns) {
                throw WorkbookApplicationException(WorkbookApplicationError.INVALID_CELL_COORDINATE)
            }
            if (write.raw.isEmpty()) cells.remove(coordinate) else cells[coordinate] = write.raw
        }
        sheet.copy(
            content = TabularContent(content.rows, content.columns, cells),
            modelFormulaBindings = bindingsBySheet[id]?.bindings ?: sheet.modelFormulaBindings,
        )
    })
    validateLifecycleWorkbook(updated)
    command.cells.forEach { write ->
        val sheet = updated.documents.getValue(SheetId(write.sheetId))
        if (ColumnId(write.columnId) in calculatedModelColumns(sheet, updated.dataModels) && !isDerivedCalculatedWrite(updated, sheet, write)) {
            throw WorkbookApplicationException(WorkbookApplicationError.CALCULATED_CELL_WRITE)
        }
    }
    return updated
}

internal fun materializeCalculatedRow(workbook: WorkbookState, sheet: SheetDocument, row: RowId): SheetDocument {
    val model = sheet.modelId?.let(workbook.dataModels::get) ?: return sheet
    val rowIndex = sheet.tabularContent.rows.indexOf(row)
    val contents = sheet.tabularContent.cellContents.toMutableMap()
    model.columns.filterIsInstance<CalculatedModelColumn>().forEach { property ->
        val column = sheet.modelColumnBindings[property.id] ?: return@forEach
        val template = sheet.modelFormulaBindings?.get(property.id)
            ?: throw WorkbookApplicationException(WorkbookApplicationError.CALCULATED_CELL_WRITE)
        contents[CellCoordinate(row, column)] = derivedFormulaRaw(template, workbook, rowIndex)
    }
    return sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents))
}
