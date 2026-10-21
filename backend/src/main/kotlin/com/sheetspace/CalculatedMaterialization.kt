package com.sheetspace

/**
 * Materializes the calculated contents of one appended row.
 *
 * The appended row receives the derived instance of the persisted template of every bound
 * calculated property, so a row never carries a user-supplied calculation override.
 */
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

/**
 * Materializes the calculated contents of every bound calculated sheet.
 *
 * A structural change that invalidates a derived instance must update the dependent sheets in the
 * same operation, so no persisted workbook keeps a calculation its declarations no longer
 * produce.
 */
internal fun materializeDerivedContents(workbook: WorkbookState): WorkbookState {
    val documents = workbook.documents.mapValues { (_, sheet) ->
        val model = sheet.modelId?.let(workbook.dataModels::get) ?: return@mapValues sheet
        val templates = sheet.modelFormulaBindings ?: return@mapValues sheet
        val contents = sheet.tabularContent.cellContents.toMutableMap()
        model.columns.filterIsInstance<CalculatedModelColumn>().forEach { property ->
            val column = sheet.modelColumnBindings[property.id] ?: return@forEach
            val template = templates[property.id] ?: return@forEach
            sheet.tabularContent.rows.forEachIndexed { rowIndex, row ->
                contents[CellCoordinate(row, column)] = derivedFormulaRaw(template, workbook, rowIndex)
            }
        }
        sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents))
    }
    return workbook.copy(documents = documents)
}
