package com.sheetspace

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

@Serializable
data class LifecycleReplayRequest(val operationId: String, val direction: String)

data class PreparedLifecycleReplay internal constructor(
    val operationId: String,
    val transitionId: String,
    val direction: String,
    val fingerprint: String,
)

internal fun prepareLifecycleReplay(transitionId: String, request: LifecycleReplayRequest): PreparedLifecycleReplay {
    val operation = request.operationId.toUuidBytesOrNull()?.toUuidString()
        ?: throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
    val transition = transitionId.toUuidBytesOrNull()?.toUuidString()
        ?: throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
    if (request.direction !in setOf("undo", "redo")) {
        throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
    }
    val fingerprint = recordFingerprint(JsonObject(mapOf(
        "action" to JsonPrimitive("lifecycle-replay"),
        "transitionId" to JsonPrimitive(transition),
        "direction" to JsonPrimitive(request.direction),
    )))
    return PreparedLifecycleReplay(operation, transition, request.direction, fingerprint)
}
