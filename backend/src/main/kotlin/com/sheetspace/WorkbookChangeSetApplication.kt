package com.sheetspace

import java.util.UUID

internal class WorkbookChangeSetApplication(
    private val store: WorkbookStore,
) {
    fun apply(changeSet: DurableChangeSet): AppliedChangeSet {
        validateActionId(changeSet.clientActionId)
        if (changeSet.operations.isEmpty()) rejectChangeSet()
        return when (changeSet) {
            is SheetScopedChangeSet -> applySheet(changeSet)
            is MultiSheetChangeSet -> applyMultiSheet(changeSet)
        }
    }

    private fun applySheet(changeSet: SheetScopedChangeSet): AppliedChangeSet {
        validateBackendId(changeSet.sheetId.value)
        if (changeSet.expectedRevision < 0) rejectChangeSet()
        return store.applyChangeSet(changeSet) { current ->
            var sheet = current.findSheet(changeSet.sheetId)
                ?: rejectChangeSet(WorkbookApplicationError.SHEET_NOT_FOUND)
            val applied = mutableListOf<AppliedOperation>()
            changeSet.operations.forEach { operation ->
                when (operation) {
                    is SheetChangeOperation.Rename -> {
                        val name = validatedName(operation.name, current, sheet.id)
                        sheet = sheet.rename(name)
                        applied += AppliedOperation("rename-sheet", sheet.id.value, name = name)
                    }
                    is SheetChangeOperation.SetCellContent -> {
                        validateBackendId(operation.coordinate.rowId.value)
                        validateBackendId(operation.coordinate.columnId.value)
                        if (sheet.tabularContent.addressOf(operation.coordinate) == null) {
                            rejectChangeSet(WorkbookApplicationError.INVALID_CELL_ADDRESS)
                        }
                        val contents = if (operation.raw.isEmpty()) {
                            sheet.tabularContent.cellContents - operation.coordinate
                        } else {
                            sheet.tabularContent.cellContents + (operation.coordinate to operation.raw)
                        }
                        sheet = sheet.updateTabularContent { TabularContent(it.rows, it.columns, contents) }
                        applied += AppliedOperation(
                            "set-cell-content", sheet.id.value,
                            rowId = operation.coordinate.rowId.value,
                            columnId = operation.coordinate.columnId.value,
                            raw = operation.raw,
                        )
                    }
                    SheetChangeOperation.AppendRow -> {
                        val rowId = RowId.generate()
                        sheet = sheet.updateTabularContent { TabularContent(it.rows + rowId, it.columns, it.cellContents) }
                        applied += AppliedOperation("append-row", sheet.id.value, rowId = rowId.value)
                    }
                    SheetChangeOperation.AppendColumn -> {
                        val columnId = ColumnId.generate()
                        sheet = sheet.updateTabularContent { TabularContent(it.rows, it.columns + columnId, it.cellContents) }
                        applied += AppliedOperation("append-column", sheet.id.value, columnId = columnId.value)
                    }
                    is SheetChangeOperation.SetFrame -> {
                        if (!operation.frame.isValid()) rejectChangeSet()
                        sheet = sheet.copy(frame = operation.frame)
                        applied += AppliedOperation("set-sheet-frame", sheet.id.value, frame = operation.frame)
                    }
                }
            }
            ChangeSetMutation(current.replaceSheet(sheet), applied)
        }
    }

    private fun applyMultiSheet(changeSet: MultiSheetChangeSet): AppliedChangeSet {
        validateMultiSheetShape(changeSet)
        return store.applyChangeSet(changeSet) { initial ->
            var workbook = initial
            val applied = mutableListOf<AppliedOperation>()
            changeSet.operations.forEach { operation ->
                when (operation) {
                    is MultiSheetChangeOperation.CreateSheet -> {
                        if (!operation.frame.isValid()) rejectChangeSet()
                        val created = when (val result = createSheetDocument(
                            operation.name,
                            workbook.documents.values,
                            operation.frame.position,
                            operation.frame.size,
                            operation.frame.zIndex,
                        )) {
                            is SheetNameResult.Valid -> result.value
                            is SheetNameResult.Invalid -> rejectChangeSet(result.reason.applicationError)
                        }
                        workbook = workbook.addSheet(created)
                        applied += AppliedOperation(
                            "create-sheet", created.id.value,
                            creationKey = operation.creationKey,
                            name = created.name,
                            frame = created.frame,
                            rowIds = created.tabularContent.rows.map { it.value },
                            columnIds = created.tabularContent.columns.map { it.value },
                        )
                    }
                    is MultiSheetChangeOperation.DeleteSheet -> {
                        if (workbook.findSheet(operation.sheetId) == null) {
                            rejectChangeSet(WorkbookApplicationError.SHEET_NOT_FOUND)
                        }
                        workbook = workbook.removeSheet(operation.sheetId)
                        applied += AppliedOperation("delete-sheet", operation.sheetId.value)
                    }
                    is MultiSheetChangeOperation.SetSheetZIndex -> {
                        if (operation.zIndex < 1) rejectChangeSet()
                        val sheet = workbook.findSheet(operation.sheetId)
                            ?: rejectChangeSet(WorkbookApplicationError.SHEET_NOT_FOUND)
                        workbook = workbook.replaceSheet(sheet.updateFrame { it.copy(zIndex = operation.zIndex) })
                        applied += AppliedOperation("set-sheet-z-index", operation.sheetId.value, zIndex = operation.zIndex)
                    }
                }
            }
            ChangeSetMutation(workbook, applied)
        }
    }

    private fun validateMultiSheetShape(changeSet: MultiSheetChangeSet) {
        if (changeSet.expectedManifestRevision?.let { it < 0 } == true ||
            changeSet.expectedSheetRevisions.any { it.revision < 0 } ||
            changeSet.expectedSheetRevisions.map { it.sheetId }.distinct().size != changeSet.expectedSheetRevisions.size
        ) {
            rejectChangeSet()
        }
        changeSet.expectedSheetRevisions.forEach { validateBackendId(it.sheetId.value) }
        val touchesManifest = changeSet.operations.any {
            it is MultiSheetChangeOperation.CreateSheet || it is MultiSheetChangeOperation.DeleteSheet
        }
        if (touchesManifest != (changeSet.expectedManifestRevision != null)) rejectChangeSet()
        val touchedExistingIds = changeSet.operations.mapNotNull {
            when (it) {
                is MultiSheetChangeOperation.DeleteSheet -> it.sheetId
                is MultiSheetChangeOperation.SetSheetZIndex -> it.sheetId
                is MultiSheetChangeOperation.CreateSheet -> null
            }
        }.toSet()
        touchedExistingIds.forEach { validateBackendId(it.value) }
        if (changeSet.expectedSheetRevisions.map { it.sheetId }.toSet() != touchedExistingIds) rejectChangeSet()
        val creationKeys = changeSet.operations.filterIsInstance<MultiSheetChangeOperation.CreateSheet>().map { it.creationKey }
        if (creationKeys.distinct().size != creationKeys.size || creationKeys.any { it != changeSet.clientActionId }) {
            rejectChangeSet()
        }
        creationKeys.forEach(::validateActionId)
    }

    private fun validatedName(name: String, workbook: WorkbookState, sheetId: SheetId): String =
        when (val result = validateSheetName(name, workbook.documents.values, sheetId)) {
            is SheetNameResult.Valid -> result.value
            is SheetNameResult.Invalid -> rejectChangeSet(result.reason.applicationError)
        }
}

private fun validateActionId(value: String) {
    val parsed = runCatching { UUID.fromString(value) }.getOrNull()
    if (parsed == null || parsed.toString() != value) rejectChangeSet(WorkbookApplicationError.INVALID_ACTION_ID)
}

private fun validateBackendId(value: String) {
    val parsed = runCatching { UUID.fromString(value) }.getOrNull()
    if (parsed == null || parsed.toString() != value) rejectChangeSet()
}

private fun rejectChangeSet(
    error: WorkbookApplicationError = WorkbookApplicationError.INVALID_CHANGE_SET,
): Nothing = throw WorkbookApplicationException(error)
