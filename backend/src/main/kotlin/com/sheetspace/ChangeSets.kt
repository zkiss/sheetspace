package com.sheetspace

import java.security.MessageDigest
import kotlinx.serialization.Serializable

const val CHANGE_SET_VERSION = 1

@Serializable
data class SheetRevisionExpectation(
    val sheetId: SheetId,
    val revision: Long,
)

sealed interface DurableChangeSet {
    val clientActionId: String
    val expectedManifestRevision: Long?
    val expectedSheetRevisions: List<SheetRevisionExpectation>
    val operations: List<ChangeSetOperation>
}

data class SheetScopedChangeSet(
    override val clientActionId: String,
    val sheetId: SheetId,
    val expectedRevision: Long,
    override val operations: List<SheetChangeOperation>,
) : DurableChangeSet {
    override val expectedManifestRevision: Long? = null
    override val expectedSheetRevisions: List<SheetRevisionExpectation> =
        listOf(SheetRevisionExpectation(sheetId, expectedRevision))
}

data class MultiSheetChangeSet(
    override val clientActionId: String,
    override val expectedManifestRevision: Long?,
    override val expectedSheetRevisions: List<SheetRevisionExpectation>,
    override val operations: List<MultiSheetChangeOperation>,
) : DurableChangeSet

sealed interface ChangeSetOperation

sealed interface SheetChangeOperation : ChangeSetOperation {
    data class Rename(val name: String) : SheetChangeOperation
    data class SetCellContent(val coordinate: CellCoordinate, val raw: String) : SheetChangeOperation
    data object AppendRow : SheetChangeOperation
    data object AppendColumn : SheetChangeOperation
    data class SetFrame(val frame: FrameState) : SheetChangeOperation
}

sealed interface MultiSheetChangeOperation : ChangeSetOperation {
    data class CreateSheet(
        val creationKey: String,
        val name: String,
        val frame: FrameState,
    ) : MultiSheetChangeOperation

    data class DeleteSheet(val sheetId: SheetId) : MultiSheetChangeOperation
    data class SetSheetZIndex(val sheetId: SheetId, val zIndex: Int) : MultiSheetChangeOperation
}

@Serializable
data class AppliedOperation(
    val kind: String,
    val sheetId: String,
    val creationKey: String? = null,
    val name: String? = null,
    val rowId: String? = null,
    val columnId: String? = null,
    val raw: String? = null,
    val frame: FrameState? = null,
    val zIndex: Int? = null,
    val rowIds: List<String>? = null,
    val columnIds: List<String>? = null,
)

@Serializable
data class AppliedChangeSet(
    val version: Int = CHANGE_SET_VERSION,
    val clientActionId: String,
    val manifestRevision: Long? = null,
    val sheetRevisions: List<SheetRevisionExpectation>,
    val operations: List<AppliedOperation>,
)

data class ChangeSetMutation(
    val workbook: WorkbookState,
    val operations: List<AppliedOperation>,
)

data class AggregateRevisionConflict(
    val aggregate: String,
    val sheetId: String? = null,
    val expectedRevision: Long,
    val actualRevision: Long,
)

class ChangeSetRevisionConflict(
    val conflicts: List<AggregateRevisionConflict>,
) : RuntimeException("Change set revision conflict: $conflicts")

class ActionIdReuseConflict(val clientActionId: String) :
    RuntimeException("Action id was reused for different content: $clientActionId")

internal fun DurableChangeSet.fingerprint(): String {
    val canonical = buildString {
        fun token(value: Any?) {
            val text = value?.toString() ?: ""
            append(text.length).append(':').append(text)
        }
        token(if (this@fingerprint is SheetScopedChangeSet) "sheet" else "multi-sheet")
        token(clientActionId)
        token(expectedManifestRevision)
        expectedSheetRevisions.sortedBy { it.sheetId.value }.forEach {
            token(it.sheetId.value)
            token(it.revision)
        }
        token(operations.size)
        operations.forEach { operation ->
            when (operation) {
                is SheetChangeOperation.Rename -> {
                    token("rename-sheet")
                    token(operation.name)
                }
                is SheetChangeOperation.SetCellContent -> {
                    token("set-cell-content")
                    token(operation.coordinate.rowId.value)
                    token(operation.coordinate.columnId.value)
                    token(operation.raw)
                }
                SheetChangeOperation.AppendRow -> token("append-row")
                SheetChangeOperation.AppendColumn -> token("append-column")
                is SheetChangeOperation.SetFrame -> {
                    token("set-sheet-frame")
                    token(operation.frame.position.x)
                    token(operation.frame.position.y)
                    token(operation.frame.size.width)
                    token(operation.frame.size.height)
                    token(operation.frame.zIndex)
                }
                is MultiSheetChangeOperation.CreateSheet -> {
                    token("create-sheet")
                    token(operation.creationKey)
                    token(operation.name)
                    token(operation.frame.position.x)
                    token(operation.frame.position.y)
                    token(operation.frame.size.width)
                    token(operation.frame.size.height)
                    token(operation.frame.zIndex)
                }
                is MultiSheetChangeOperation.DeleteSheet -> {
                    token("delete-sheet")
                    token(operation.sheetId.value)
                }
                is MultiSheetChangeOperation.SetSheetZIndex -> {
                    token("set-sheet-z-index")
                    token(operation.sheetId.value)
                    token(operation.zIndex)
                }
            }
        }
    }
    return MessageDigest.getInstance("SHA-256")
        .digest(canonical.toByteArray())
        .joinToString("") { "%02x".format(it) }
}

internal fun applyChangeSetToWorkbook(
    current: WorkbookState,
    changeSet: DurableChangeSet,
    transform: (WorkbookState) -> ChangeSetMutation,
): Pair<WorkbookState, AppliedChangeSet> {
    val conflicts = buildList {
        changeSet.expectedManifestRevision?.let { expected ->
            if (current.manifest.revision != expected) {
                add(AggregateRevisionConflict("manifest", expectedRevision = expected, actualRevision = current.manifest.revision))
            }
        }
        changeSet.expectedSheetRevisions.forEach { expected ->
            val actual = current.findSheet(expected.sheetId)?.revision ?: -1
            if (actual != expected.revision) {
                add(AggregateRevisionConflict("sheet", expected.sheetId.value, expected.revision, actual))
            }
        }
    }
    if (conflicts.isNotEmpty()) throw ChangeSetRevisionConflict(conflicts)

    val mutation = transform(current)
    val expectedIds = changeSet.expectedSheetRevisions.map { it.sheetId }.toSet()
    val documents = mutation.workbook.documents.mapValues { (id, sheet) ->
        val previous = current.findSheet(id)
        if (id in expectedIds && previous != null) sheet.copy(revision = previous.revision + 1) else sheet
    }
    val manifest = if (changeSet.expectedManifestRevision == null) {
        mutation.workbook.manifest
    } else {
        mutation.workbook.manifest.copy(revision = current.manifest.revision + 1)
    }
    val updated = WorkbookState(manifest, documents)
    val createdIds = mutation.operations
        .filter { it.kind == "create-sheet" }
        .map { SheetId(it.sheetId) }
        .toSet()
    val touchedIds = expectedIds + createdIds
    return updated to AppliedChangeSet(
        clientActionId = changeSet.clientActionId,
        manifestRevision = changeSet.expectedManifestRevision?.let { updated.manifest.revision },
        sheetRevisions = updated.sheetsInOrder
            .filter { it.id in touchedIds }
            .map { SheetRevisionExpectation(it.id, it.revision) },
        operations = mutation.operations,
    )
}
