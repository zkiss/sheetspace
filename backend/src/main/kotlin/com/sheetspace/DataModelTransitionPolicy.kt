package com.sheetspace

/**
 * The storage boundary's authority for aggregate model changes.  A bundle is not a permission to
 * replace arbitrary workbook state: calculated raws and the bound table shape are derived state.
 */
internal object DataModelTransitionPolicy {
    fun permitsBootstrap(workbook: WorkbookState): Boolean {
        if (workbook.dataModels.isEmpty() && workbook.sheetsInOrder.none { it.dataModelId != null }) return true
        return hasValidIdentities(workbook) && workbook.sheetsInOrder.all { sheet ->
            sheet.dataModelId?.let(workbook.dataModels::get)?.let { model ->
                hasOnlyModelOwnedCalculatedContents(workbook, sheet.id, model)
            } ?: true
        }
    }

    fun permitsTransition(before: WorkbookState, after: WorkbookState): Boolean {
        val aggregateTransition = requiresAggregateCas(before, after)
        if (!hasModelTransition(before, after)) return true
        if (!hasValidIdentities(after)) return false
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
            workbook.manifest.sheetIds != workbook.documents.keys.toList() ||
            workbook.dataModels.keys.any { it.toUuidBytesOrNull() == null }
        ) return false
        if (workbook.dataModels.any { (id, model) ->
                id != model.id || model.id.toUuidBytesOrNull() == null || model.name.isBlank() ||
                    model.properties.map { it.id }.distinct().size != model.properties.size ||
                    model.properties.any { it.id.toUuidBytesOrNull() == null || it.name.isBlank() } ||
                    model.properties.map { it.name.trim().lowercase() }.distinct().size != model.properties.size
            }) return false
        return workbook.sheetsInOrder.all { sheet ->
            sheet.id.value.toUuidBytesOrNull() != null && sheet.dataModelId?.let(workbook.dataModels::containsKey) != false
        }
    }

    private fun validBind(
        before: WorkbookState,
        after: WorkbookState,
        oldSheet: SheetDocument,
        newSheet: SheetDocument,
        model: DataModel,
    ): Boolean =
        oldSheet.name == newSheet.name && oldSheet.frame == newSheet.frame &&
            oldSheet.presentation == newSheet.presentation &&
            oldSheet.tabularContent.rows == newSheet.tabularContent.rows &&
            newSheet.tabularContent.columns.size == model.properties.size &&
            oldSheet.tabularContent.columns.indices.all { index ->
                val oldColumn = oldSheet.tabularContent.columns[index]
                val newColumn = newSheet.tabularContent.columns.getOrNull(index) ?: return@all true
                if (oldColumn != newColumn) return@all false
                if (model.properties[index] is CalculatedDataModelProperty) return@all true
                oldSheet.tabularContent.rows.all { row ->
                    oldSheet.tabularContent.cellContents[CellCoordinate(row, oldColumn)] ==
                        newSheet.tabularContent.cellContents[CellCoordinate(row, newColumn)]
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
            oldSheet.frame != newSheet.frame || oldSheet.presentation != newSheet.presentation ||
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
}
