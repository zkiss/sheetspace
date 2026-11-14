package com.sheetspace

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement

data class PreparedFunctionMutation(val operationId: String, val fingerprint: String)

data class FunctionMutationResult(val workbook: WorkbookState, val committedIdentity: String, val previous: CustomFunction? = null, val next: CustomFunction? = null)

data class StoredFunctionMutation(val workbook: WorkbookState, val committedIdentity: String, val alreadyCommitted: Boolean)

@Serializable
data class FunctionMutationResponse(val operationId: String, val committedIdentity: String, val alreadyCommitted: Boolean, val workbook: WorkbookBundleResponse)

internal fun prepareFunctionMutation(operationId: String, before: WorkbookBundleResponse, kind: String, payload: kotlinx.serialization.json.JsonElement): Pair<PreparedFunctionMutation, WorkbookState> {
    val operation = operationId.toUuidBytesOrNull()?.toUuidString() ?: throw WorkbookApplicationException(WorkbookApplicationError.INVALID_FUNCTION)
    val normalized = try {
        normalizeRecordGuard(before)
    } catch (_: WorkbookApplicationException) {
        throw WorkbookApplicationException(WorkbookApplicationError.INVALID_FUNCTION)
    }
    val fingerprint = recordFingerprint(JsonObject(mapOf(
        "kind" to JsonPrimitive(kind),
        "before" to Json.encodeToJsonElement(WorkbookReadTransportAdapter.bundle(normalized)),
        "payload" to payload,
    )))
    return PreparedFunctionMutation(operation, fingerprint) to normalized
}
