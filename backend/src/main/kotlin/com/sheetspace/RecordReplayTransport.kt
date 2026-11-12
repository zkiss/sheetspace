package com.sheetspace

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class RecordReplayRequest(val operationId: String, val direction: String, val before: WorkbookBundleResponse)

@Serializable
data class RecordReplayResult(val operationId: String, val rowId: String, val alreadyCommitted: Boolean, val workbook: WorkbookBundleResponse)

private val replayJson = Json { ignoreUnknownKeys = true }

internal suspend fun ApplicationCall.receiveRecordReplayRequest(): RecordReplayRequest? = try {
    replayJson.decodeFromString<RecordReplayRequest>(receiveText())
} catch (_: Exception) {
    respond(HttpStatusCode.BadRequest, ErrorResponse("invalid-request"))
    null
}

internal suspend fun ApplicationCall.receiveRecordDeletionRequest(): RecordDeletionRequest? = try {
    replayJson.decodeFromString<RecordDeletionRequest>(receiveText())
} catch (_: Exception) {
    respond(HttpStatusCode.BadRequest, ErrorResponse("invalid-request"))
    null
}
