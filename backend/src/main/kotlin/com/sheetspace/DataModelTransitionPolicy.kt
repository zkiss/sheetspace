package com.sheetspace

/**
 * The storage boundary's authority for aggregate model changes.  A bundle is not a permission to
 * replace arbitrary workbook state: calculated raws and the bound table shape are derived state.
 */
internal object DataModelTransitionPolicy {
    fun permitsBootstrap(workbook: WorkbookState): Boolean {
        // A pristine aggregate save is still an authority boundary.  In particular, an
        // unbound workbook is not exempt from durable UUID/shape validation.
        return hasValidIdentities(workbook) && hasValidModelDefinitions(workbook) && workbook.sheetsInOrder.all { sheet ->
            sheet.dataModelId?.let(workbook.dataModels::get)?.let { model ->
                hasOnlyModelOwnedCalculatedContents(workbook, sheet.id, model)
            } ?: true
        }
    }

    fun permitsTransition(before: WorkbookState, after: WorkbookState): Boolean {
        val aggregateTransition = requiresAggregateCas(before, after)
        val appendedBoundSheets = boundContentChanges(before, after)
        // Append is a command-shaped operation, not a composition of independently valid sheet
        // projections.  In particular, accepting two otherwise valid appends here would let the
        // singleton updateWorkbook revision precondition protect only one of them.
        if (!aggregateTransition && appendedBoundSheets.isNotEmpty()) {
            if (appendedBoundSheets.size != 1 || before.manifest != after.manifest) return false
            val appendedSheetId = appendedBoundSheets.single()
            return before.sheetsInOrder.all { oldSheet ->
                val newSheet = after.documents.getValue(oldSheet.id)
                if (oldSheet.id != appendedSheetId) oldSheet == newSheet
                else {
                    val model = before.dataModels.getValue(oldSheet.dataModelId!!)
                    newSheet.dataModelId == oldSheet.dataModelId &&
                        validBoundTransition(before, after, oldSheet, newSheet, model, model)
                }
            }
        }
        if (!hasModelTransition(before, after)) return true
        if (!hasValidIdentities(after) || !hasValidModelDefinitions(after)) return false
        if (aggregateTransition &&
            (before.manifest != after.manifest || before.documents.keys != after.documents.keys)
        ) return false

        val changedModelIds = (before.dataModels.keys + after.dataModels.keys).filter { modelId ->
            before.dataModels[modelId] != after.dataModels[modelId]
        }.toSet()

        return before.sheetsInOrder.all { oldSheet ->
            val newSheet = after.documents.getValue(oldSheet.id)
            val oldModel = oldSheet.dataModelId?.let(before.dataModels::get)
            val newModel = newSheet.dataModelId?.let(after.dataModels::get)
            val affectedByAggregateTransition = oldSheet.dataModelId != newSheet.dataModelId ||
                oldSheet.dataModelId in changedModelIds

            if (aggregateTransition && !affectedByAggregateTransition) return@all oldSheet == newSheet

            when {
                // The aggregate-mode guard above has already required untouched sheets to match.
                oldModel == null && newModel == null -> true
                oldModel == null -> validBind(before, after, oldSheet, newSheet, newModel!!)
                newModel == null -> validUnbind(oldSheet, newSheet, oldModel)
                else -> validBoundTransition(before, after, oldSheet, newSheet, oldModel, newModel)
            }
        }
    }

    /** A model or binding change needs an aggregate baseline, even when no sheets use that model. */
    fun requiresAggregateCas(before: WorkbookState, after: WorkbookState): Boolean =
        before.dataModels != after.dataModels || (before.documents.keys + after.documents.keys).any { sheetId ->
            before.documents[sheetId]?.dataModelId != after.documents[sheetId]?.dataModelId
        }

    /** Every sheet whose binding or model-owned projection can change needs a direct-store guard. */
    fun affectedAggregateSheets(before: WorkbookState, after: WorkbookState): Set<SheetId> {
        val changedModelIds = (before.dataModels.keys + after.dataModels.keys)
            .filter { before.dataModels[it] != after.dataModels[it] }
            .toSet()
        return before.documents.values.filter { sheet ->
            val updated = after.documents[sheet.id] ?: return@filter false
            sheet.dataModelId != updated.dataModelId ||
                sheet.dataModelId in changedModelIds
        }.map(SheetDocument::id).toSet()
    }

    /** A normal bound append is not an aggregate change, but still must carry its sheet baseline. */
    fun requiresBoundAppendCas(before: WorkbookState, after: WorkbookState): Boolean =
        !requiresAggregateCas(before, after) && boundContentChanges(before, after).isNotEmpty()

    fun boundContentChanges(before: WorkbookState, after: WorkbookState): Set<SheetId> =
        before.documents.filter { (id, sheet) ->
            sheet.dataModelId != null && after.documents[id]?.tabularContent != sheet.tabularContent
        }.keys

    private fun hasModelTransition(before: WorkbookState, after: WorkbookState): Boolean =
        requiresAggregateCas(before, after) || before.documents.any { (id, sheet) ->
            after.documents[id]?.let { updated ->
                sheet.dataModelId != null && updated.tabularContent != sheet.tabularContent
            } ?: false
        }

    private fun hasValidIdentities(workbook: WorkbookState): Boolean {
        if (workbook.manifest.version != WORKBOOK_SCHEMA_VERSION ||
            !workbook.manifest.sheetIds.map(SheetId::value).hasDistinctUuidIdentities() ||
            workbook.manifest.sheetIds.toSet() != workbook.documents.keys ||
            workbook.documents.any { (id, sheet) -> id != sheet.id } ||
            !workbook.dataModels.keys.hasDistinctUuidIdentities()
        ) return false
        if (workbook.dataModels.any { (id, model) ->
                id != model.id || model.name.isBlank() ||
                    !model.properties.map(DataModelProperty::id).hasDistinctUuidIdentities() ||
                    model.properties.any { it.name.isBlank() } ||
                    model.properties.map { it.name.trim().lowercase() }.distinct().size != model.properties.size
            }) return false
        return workbook.sheetsInOrder.all { sheet ->
            sheet.dataModelId?.let(workbook.dataModels::containsKey) != false &&
                hasValidTabularIdentities(sheet.tabularContent)
        }
    }

    /**
     * Formula ownership has rows to compare, but formula admission must not depend on there being
     * a row (or a binding) at all.  Models are aggregate state in their own right.
     */
    private fun hasValidModelDefinitions(workbook: WorkbookState): Boolean =
        workbook.dataModels.values.all { model ->
            model.properties.filterIsInstance<CalculatedDataModelProperty>()
                .all { property -> isSupportedFormula(property.formula) }
        }

    private fun hasValidTabularIdentities(content: TabularContent): Boolean =
        content.rows.map(RowId::value).hasDistinctUuidIdentities() &&
            content.columns.map(ColumnId::value).hasDistinctUuidIdentities() &&
            content.cellContents.keys.all { coordinate ->
                coordinate.rowId in content.rows && coordinate.columnId in content.columns
            }

    private fun validBind(
        before: WorkbookState,
        after: WorkbookState,
        oldSheet: SheetDocument,
        newSheet: SheetDocument,
        model: DataModel,
    ): Boolean =
        oldSheet.name == newSheet.name && oldSheet.frame == newSheet.frame &&
            newSheet.presentation == oldSheet.presentation.prunedTo(newSheet.tabularContent) &&
            oldSheet.tabularContent.rows == newSheet.tabularContent.rows &&
            newSheet.tabularContent.columns.size == model.properties.size &&
            model.properties.withIndex().all { (index, property) ->
                val newColumn = newSheet.tabularContent.columns[index]
                val oldColumn = oldSheet.tabularContent.columns.getOrNull(index)
                if (oldColumn == null) {
                    property is CalculatedDataModelProperty || newSheet.tabularContent.rows.all { row ->
                        CellCoordinate(row, newColumn) !in newSheet.tabularContent.cellContents
                    }
                } else if (oldColumn != newColumn) {
                    false
                } else if (property is CalculatedDataModelProperty) {
                    true
                } else {
                    oldSheet.tabularContent.rows.all { row ->
                        oldSheet.tabularContent.cellContents[CellCoordinate(row, oldColumn)] ==
                            newSheet.tabularContent.cellContents[CellCoordinate(row, newColumn)]
                    }
                }
            } && hasOnlyModelOwnedCalculatedContents(after, newSheet.id, model)

    private fun validUnbind(oldSheet: SheetDocument, newSheet: SheetDocument, model: DataModel): Boolean {
        if (oldSheet.name != newSheet.name || oldSheet.frame != newSheet.frame ||
            oldSheet.presentation != newSheet.presentation || oldSheet.tabularContent.rows != newSheet.tabularContent.rows ||
            oldSheet.tabularContent.columns != newSheet.tabularContent.columns
        ) return false
        return oldSheet.tabularContent.cellContents.keys.union(newSheet.tabularContent.cellContents.keys).all { coordinate ->
            val old = oldSheet.tabularContent.cellContents[coordinate]
            val new = newSheet.tabularContent.cellContents[coordinate]
            val index = oldSheet.tabularContent.columns.indexOf(coordinate.columnId)
            if (model.properties.getOrNull(index) is CalculatedDataModelProperty) new?.startsWith("=") != true else old == new
        }
    }

    private fun validBoundTransition(
        before: WorkbookState,
        after: WorkbookState,
        oldSheet: SheetDocument,
        newSheet: SheetDocument,
        oldModel: DataModel,
        newModel: DataModel,
    ): Boolean {
        if (oldSheet.dataModelId != newSheet.dataModelId || oldSheet.name != newSheet.name ||
            oldSheet.frame != newSheet.frame ||
            newSheet.presentation != oldSheet.presentation.prunedTo(newSheet.tabularContent) ||
            !hasOnlyModelOwnedCalculatedContents(before, oldSheet.id, oldModel) ||
            !hasOnlyModelOwnedCalculatedContents(after, newSheet.id, newModel)
        ) return false
        if (oldModel == newModel) return validBoundAppend(oldSheet, newSheet, oldModel)
        if (newSheet.tabularContent.rows != oldSheet.tabularContent.rows) return false
        val oldColumnsByProperty = oldModel.properties.mapIndexed { index, property -> property.id to oldSheet.tabularContent.columns.getOrNull(index) }.toMap()
        return newModel.properties.withIndex().all { (newIndex, property) ->
            val newColumn = newSheet.tabularContent.columns[newIndex]
            val oldIndex = oldModel.properties.indexOfFirst { it.id == property.id }
            if (oldIndex < 0) {
                return@all newColumn !in oldSheet.tabularContent.columns &&
                    (property is CalculatedDataModelProperty || newSheet.tabularContent.rows.all { row ->
                        CellCoordinate(row, newColumn) !in newSheet.tabularContent.cellContents
                    })
            }
            val oldColumn = oldColumnsByProperty.getValue(property.id)
            if (oldColumn != newColumn) return@all false
            oldSheet.tabularContent.rows.all { row ->
                val oldRaw = oldSheet.tabularContent.cellContents[CellCoordinate(row, oldColumn)]
                val newRaw = newSheet.tabularContent.cellContents[CellCoordinate(row, newColumn)]
                when {
                    property is CalculatedDataModelProperty -> true
                    oldModel.properties[oldIndex] is CalculatedDataModelProperty -> newRaw == null
                    else -> oldRaw == newRaw
                }
            }
        }
    }

    /** A bound-content mutation is only the single row append produced by the application command. */
    private fun validBoundAppend(oldSheet: SheetDocument, newSheet: SheetDocument, model: DataModel): Boolean {
        val oldContent = oldSheet.tabularContent
        val newContent = newSheet.tabularContent
        if (newContent.columns != oldContent.columns || newContent.rows.size != oldContent.rows.size + 1 ||
            newContent.rows.take(oldContent.rows.size) != oldContent.rows
        ) return false
        val appendedRow = newContent.rows.last()
        if (appendedRow.value.toUuidBytesOrNull() == null) return false
        if (newContent.cellContents.filterKeys { it.rowId in oldContent.rows } != oldContent.cellContents) return false
        return model.properties.withIndex().all { (index, property) ->
            property is CalculatedDataModelProperty ||
                CellCoordinate(appendedRow, newContent.columns[index]) !in newContent.cellContents
        }
    }

    /** Remove sparse presentation that belonged to columns/cells discarded by reconciliation. */
    private fun SheetPresentation.prunedTo(content: TabularContent): SheetPresentation {
        val rowIds = content.rows.map(RowId::value).toSet()
        val columnIds = content.columns.map(ColumnId::value).toSet()
        return copy(
            rowHeights = rowHeights.filterKeys(rowIds::contains),
            columnWidths = columnWidths.filterKeys(columnIds::contains),
            formatOverrides = SheetFormatOverrides(
                rows = formatOverrides.rows.filterKeys(rowIds::contains),
                columns = formatOverrides.columns.filterKeys(columnIds::contains),
                cells = formatOverrides.cells.filterKeys { target ->
                    target.split("\u0000").let { ids -> ids.size == 2 && ids[0] in rowIds && ids[1] in columnIds }
                },
            ),
        )
    }
}
