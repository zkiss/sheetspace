package com.sheetspace

/**
 * Materializes the calculated contents of one appended row.
 *
 * The appended row receives the derived instance of the persisted template of every bound
 * calculated property, so a row never carries a user-supplied calculation override.
 */
internal fun materializeCalculatedRow(workbook: WorkbookState, sheet: SheetDocument, row: RowId): SheetDocument =
    materializeCalculatedRow(workbook, sheet, row, StoredCalculatedTemplates)

internal fun <T> materializeCalculatedRow(workbook: WorkbookState, sheet: SheetDocument, row: RowId, rules: CalculatedTemplates<T>): SheetDocument {
    val model = sheet.modelId?.let(workbook.dataModels::get) ?: return sheet
    val rowIndex = sheet.tabularContent.rows.indexOf(row)
    val contents = sheet.tabularContent.cellContents.toMutableMap()
    model.columns.filterIsInstance<CalculatedModelColumn>().forEach { property ->
        val column = sheet.modelColumnBindings[property.id] ?: return@forEach
        val template = rules.templates(sheet)?.get(property.id)
            ?: throw WorkbookApplicationException(WorkbookApplicationError.CALCULATED_CELL_WRITE)
        contents[CellCoordinate(row, column)] = rules.derive(template, workbook, rowIndex, property.formula, sheet.id.value)
    }
    return sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents))
}

/**
 * Materializes the calculated contents of every bound calculated sheet.
 *
 * Structural changes never rebind surviving instances to replacement targets. Only missing output
 * coordinates receive new row-recipe instances.
 */
internal fun materializeDerivedContents(workbook: WorkbookState): WorkbookState = materializeDerivedContents(workbook, StoredCalculatedTemplates)

internal fun <T> materializeDerivedContents(workbook: WorkbookState, rules: CalculatedTemplates<T>): WorkbookState {
    val documents = workbook.documents.mapValues { (_, sheet) ->
        val model = sheet.modelId?.let(workbook.dataModels::get) ?: return@mapValues sheet
        val templates = rules.templates(sheet) ?: return@mapValues sheet
        val contents = sheet.tabularContent.cellContents.toMutableMap()
        model.columns.filterIsInstance<CalculatedModelColumn>().forEach { property ->
            val column = sheet.modelColumnBindings[property.id] ?: return@forEach
            val template = templates[property.id] ?: return@forEach
            sheet.tabularContent.rows.forEachIndexed { rowIndex, row ->
                contents.getOrPut(CellCoordinate(row, column)) { rules.derive(template, workbook, rowIndex, property.formula, sheet.id.value) }
            }
        }
        sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents))
    }
    return workbook.copy(documents = documents)
}
