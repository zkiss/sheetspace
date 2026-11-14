package com.sheetspace

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement

data class PreparedLifecycleAdmission internal constructor(
    val operationId: String,
    val before: WorkbookState,
    val after: WorkbookState,
    val fingerprint: String,
)

data class StoredLifecycleAdmission(val workbook: WorkbookState, val transitionId: String, val alreadyCommitted: Boolean)

internal fun prepareLifecycleAdmission(operationId: String, before: WorkbookBundleResponse, after: WorkbookBundleResponse): PreparedLifecycleAdmission {
    val operation = operationId.toUuidBytesOrNull()?.toUuidString()
        ?: throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
    val normalizedBefore: WorkbookState
    val normalizedAfter: WorkbookState
    try {
        normalizedBefore = normalizeRecordGuard(before)
        normalizedAfter = normalizeRecordGuard(after)
    } catch (_: WorkbookApplicationException) {
        throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
    }
    val fingerprint = recordFingerprint(JsonObject(mapOf(
        "action" to JsonPrimitive("lifecycle-admission"),
        "before" to Json.encodeToJsonElement(WorkbookReadTransportAdapter.bundle(normalizedBefore)),
        "after" to Json.encodeToJsonElement(WorkbookReadTransportAdapter.bundle(normalizedAfter)),
    )))
    return PreparedLifecycleAdmission(operation, normalizedBefore, normalizedAfter, fingerprint)
}
