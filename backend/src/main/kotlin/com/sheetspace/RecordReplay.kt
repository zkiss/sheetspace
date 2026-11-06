package com.sheetspace

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement

data class PreparedRecordReplay internal constructor(
    val operationId: String,
    val sheetId: SheetId,
    val rowId: RowId,
    val direction: String,
    val before: WorkbookState,
    val fingerprint: String,
)

internal fun prepareRecordReplay(sheetId: String, rowId: String, request: RecordReplayRequest): PreparedRecordReplay {
    if (request.direction !in setOf("undo", "redo")) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)
    val sheet = recordIdentity(sheetId)
    val row = recordIdentity(rowId)
    val operation = recordIdentity(request.operationId)
    val before = normalizeRecordGuard(request.before)
    val fingerprint = recordFingerprint(JsonObject(mapOf(
        "sheetId" to JsonPrimitive(sheet),
        "rowId" to JsonPrimitive(row),
        "direction" to JsonPrimitive(request.direction),
        "before" to Json.encodeToJsonElement(WorkbookReadTransportAdapter.bundle(before)),
    )))
    return PreparedRecordReplay(operation, SheetId(sheet), RowId(row), request.direction, before, fingerprint)
}
