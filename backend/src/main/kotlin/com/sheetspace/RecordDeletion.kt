package com.sheetspace

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement

@Serializable
data class RecordDeletionRequest(val operationId: String, val before: WorkbookBundleResponse, val rowOrders: List<RecordRowOrder> = emptyList())

@Serializable
data class RecordDeletionResult(val operationId: String, val deletionId: String, val rowId: String, val alreadyCommitted: Boolean, val workbook: WorkbookBundleResponse)

data class PreparedRecordDeletion internal constructor(val operationId: String, val sheetId: SheetId, val rowId: RowId, val before: WorkbookState, val orders: List<RecordRowOrder>, val fingerprint: String)

internal fun prepareRecordDeletion(sheetId: String, rowId: String, request: RecordDeletionRequest): PreparedRecordDeletion {
    val operation = recordIdentity(request.operationId)
    val sheet = recordIdentity(sheetId)
    val row = recordIdentity(rowId)
    val before = normalizeRecordGuard(request.before)
    val orders = request.rowOrders.map { RecordRowOrder(recordIdentity(it.sheetId), it.order.map(::recordIdentity)) }
    if (orders.map { it.sheetId }.distinct().size != orders.size) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)
    val fingerprint = recordFingerprint(JsonObject(mapOf(
        "kind" to JsonPrimitive("delete"), "sheetId" to JsonPrimitive(sheet), "rowId" to JsonPrimitive(row),
        "before" to Json.encodeToJsonElement(WorkbookReadTransportAdapter.bundle(before)),
        "orders" to Json.encodeToJsonElement(orders.sortedBy { it.sheetId }),
    )))
    return PreparedRecordDeletion(operation, SheetId(sheet), RowId(row), before, orders, fingerprint)
}

internal fun deleteRecord(current: WorkbookState, request: PreparedRecordDeletion): RecordAdmissionStages {
    guardRecordWorkbook(current, request.before)
    val sheet = current.findSheet(request.sheetId) ?: throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND, request.sheetId.value)
    if (sheet.modelId !in current.dataModels || request.rowId !in sheet.tabularContent.rows) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)
    val content = sheet.tabularContent
    val presentation = sheet.presentation
    val formats = presentation.formatOverrides
    val deletedSheet = sheet.copy(
        content = TabularContent(content.rows - request.rowId, content.columns, content.cellContents.filterKeys { it.rowId != request.rowId }),
        presentation = presentation.copy(rowHeights = presentation.rowHeights - request.rowId.value, formatOverrides = formats.copy(
            rows = formats.rows - request.rowId.value, cells = formats.cells.filterKeys { it.substringBefore('\u0000') != request.rowId.value },
        )),
    )
    val deleted = current.replaceSheet(deletedSheet)
    val ordered = applyRecordOrders(deleted, request.orders)
    validateLifecycleWorkbook(deleted)
    validateLifecycleWorkbook(ordered)
    return RecordAdmissionStages(deleted, ordered)
}

@Serializable
data class RecordDeletionReplayResult(val operationId: String, val deletionId: String, val rowId: String, val alreadyCommitted: Boolean, val workbook: WorkbookBundleResponse)

data class PreparedDeletionReplay internal constructor(val operationId: String, val deletionId: String, val sheetId: SheetId, val rowId: RowId, val direction: String, val before: WorkbookState, val fingerprint: String)

internal fun prepareDeletionReplay(sheetId: String, rowId: String, deletionId: String, request: RecordReplayRequest): PreparedDeletionReplay {
    if (request.direction !in setOf("undo", "redo")) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)
    val sheet = recordIdentity(sheetId)
    val row = recordIdentity(rowId)
    val deletion = recordIdentity(deletionId)
    val operation = recordIdentity(request.operationId)
    val before = normalizeRecordGuard(request.before)
    val fingerprint = recordFingerprint(JsonObject(mapOf(
        "kind" to JsonPrimitive("deletion-replay"), "sheetId" to JsonPrimitive(sheet), "rowId" to JsonPrimitive(row),
        "deletionId" to JsonPrimitive(deletion), "direction" to JsonPrimitive(request.direction),
        "before" to Json.encodeToJsonElement(WorkbookReadTransportAdapter.bundle(before)),
    )))
    return PreparedDeletionReplay(operation, deletion, SheetId(sheet), RowId(row), request.direction, before, fingerprint)
}
