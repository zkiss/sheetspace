package com.sheetspace

import kotlinx.serialization.Serializable

@Serializable
data class SheetFormulaBindingWrite(val sheetId: String, val bindings: Map<String, BoundModelFormula>)

/** Calculated row contents and their stable template targets share one revision-checked transaction. */
internal fun applyModelRowPatch(current: WorkbookState, command: CellPatchCommand): WorkbookState {
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
