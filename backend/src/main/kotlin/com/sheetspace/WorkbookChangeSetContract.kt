package com.sheetspace

import kotlinx.serialization.Serializable

@Serializable
data class ChangeSetRequest(
    val version: Int,
    val scope: String,
    val clientActionId: String,
    val sheetId: String? = null,
    val expectedRevision: ChangeSetRevisionRequest? = null,
    val expectedManifestRevision: Long? = null,
    val expectedSheetRevisions: List<ChangeSetRevisionRequest>? = null,
    val operations: List<ChangeSetOperationRequest>,
)

@Serializable
data class ChangeSetRevisionRequest(
    val sheetId: String,
    val revision: Long,
)

@Serializable
data class StableCellRequest(
    val rowId: String,
    val columnId: String,
)

@Serializable
data class ChangeSetOperationRequest(
    val kind: String,
    val creationKey: String? = null,
    val sheetId: String? = null,
    val name: String? = null,
    val cell: StableCellRequest? = null,
    val raw: String? = null,
    val frame: FrameState? = null,
    val zIndex: Int? = null,
)

@Serializable
data class RevisionConflictResponse(
    val error: String,
    val conflicts: List<RevisionConflictItemResponse>,
)

@Serializable
data class RevisionConflictItemResponse(
    val aggregate: String,
    val sheetId: String? = null,
    val expectedRevision: Long,
    val actualRevision: Long,
)

internal object WorkbookChangeSetTransportAdapter {
    fun request(request: ChangeSetRequest): DurableChangeSet {
        if (request.version != CHANGE_SET_VERSION) rejectChangeSet(WorkbookApplicationError.UNSUPPORTED_CHANGE_SET_VERSION)
        return when (request.scope) {
            "sheet" -> sheetRequest(request)
            "multi-sheet" -> multiSheetRequest(request)
            else -> rejectChangeSet(WorkbookApplicationError.INVALID_CHANGE_SET)
        }
    }

    private fun sheetRequest(request: ChangeSetRequest): SheetScopedChangeSet {
        val sheetId = request.sheetId ?: rejectChangeSet(WorkbookApplicationError.INVALID_CHANGE_SET)
        val expected = request.expectedRevision ?: rejectChangeSet(WorkbookApplicationError.INVALID_CHANGE_SET)
        if (expected.sheetId != sheetId || request.expectedManifestRevision != null || request.expectedSheetRevisions != null) {
            rejectChangeSet(WorkbookApplicationError.INVALID_CHANGE_SET)
        }
        return SheetScopedChangeSet(
            clientActionId = request.clientActionId,
            sheetId = SheetId(sheetId),
            expectedRevision = expected.revision,
            operations = request.operations.map(::sheetOperation),
        )
    }

    private fun multiSheetRequest(request: ChangeSetRequest): MultiSheetChangeSet {
        if (request.sheetId != null || request.expectedRevision != null || request.expectedSheetRevisions == null) {
            rejectChangeSet(WorkbookApplicationError.INVALID_CHANGE_SET)
        }
        return MultiSheetChangeSet(
            clientActionId = request.clientActionId,
            expectedManifestRevision = request.expectedManifestRevision,
            expectedSheetRevisions = request.expectedSheetRevisions.map {
                SheetRevisionExpectation(SheetId(it.sheetId), it.revision)
            },
            operations = request.operations.map { multiSheetOperation(it, request.clientActionId) },
        )
    }

    private fun sheetOperation(operation: ChangeSetOperationRequest): SheetChangeOperation = when (operation.kind) {
        "rename-sheet" -> {
            operation.requireOnly(name = true)
            SheetChangeOperation.Rename(operation.name!!)
        }
        "set-cell-content" -> {
            operation.requireOnly(cell = true, raw = true)
            SheetChangeOperation.SetCellContent(
                CellCoordinate(RowId(operation.cell!!.rowId), ColumnId(operation.cell.columnId)),
                operation.raw!!,
            )
        }
        "append-row" -> {
            operation.requireOnly()
            SheetChangeOperation.AppendRow
        }
        "append-column" -> {
            operation.requireOnly()
            SheetChangeOperation.AppendColumn
        }
        "set-sheet-frame" -> {
            operation.requireOnly(frame = true)
            SheetChangeOperation.SetFrame(operation.frame!!)
        }
        else -> rejectChangeSet(WorkbookApplicationError.INVALID_CHANGE_SET)
    }

    private fun multiSheetOperation(
        operation: ChangeSetOperationRequest,
        clientActionId: String,
    ): MultiSheetChangeOperation = when (operation.kind) {
        "create-sheet" -> {
            operation.requireOnly(creationKey = true, name = true, frame = true)
            if (operation.creationKey != clientActionId) rejectChangeSet(WorkbookApplicationError.INVALID_CHANGE_SET)
            MultiSheetChangeOperation.CreateSheet(operation.creationKey!!, operation.name!!, operation.frame!!)
        }
        "delete-sheet" -> {
            operation.requireOnly(sheetId = true)
            MultiSheetChangeOperation.DeleteSheet(SheetId(operation.sheetId!!))
        }
        "set-sheet-z-index" -> {
            operation.requireOnly(sheetId = true, zIndex = true)
            MultiSheetChangeOperation.SetSheetZIndex(SheetId(operation.sheetId!!), operation.zIndex!!)
        }
        else -> rejectChangeSet(WorkbookApplicationError.INVALID_CHANGE_SET)
    }

    private fun ChangeSetOperationRequest.requireOnly(
        creationKey: Boolean = false,
        sheetId: Boolean = false,
        name: Boolean = false,
        cell: Boolean = false,
        raw: Boolean = false,
        frame: Boolean = false,
        zIndex: Boolean = false,
    ) {
        if (
            (this.creationKey != null) != creationKey ||
            (this.sheetId != null) != sheetId ||
            (this.name != null) != name ||
            (this.cell != null) != cell ||
            (this.raw != null) != raw ||
            (this.frame != null) != frame ||
            (this.zIndex != null) != zIndex
        ) {
            rejectChangeSet(WorkbookApplicationError.INVALID_CHANGE_SET)
        }
    }
}

private fun rejectChangeSet(error: WorkbookApplicationError): Nothing =
    throw WorkbookApplicationException(error)
