package com.sheetspace

import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.http.content.default
import io.ktor.server.http.content.staticResources
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.request.receive
import io.ktor.server.request.receiveText
import io.ktor.server.response.respond
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class PresentationWriteRequest(val writes: List<AxisSizeWrite> = emptyList(), val formatWrites: List<FormatWrite> = emptyList())

@Serializable
data class HealthResponse(val status: String, val service: String)

@Serializable
data class CreateSheetRequest(
    val name: String,
    val position: WorkspacePosition = WorkspacePosition(),
    val frameSize: SheetFrameSize = SheetFrameSize(),
    val visualScale: Double = DEFAULT_SHEET_VISUAL_SCALE,
    val zIndex: Int? = null,
)

@Serializable
data class UpdateSheetRequest(
    val name: String? = null,
    val position: WorkspacePosition? = null,
    val frameSize: SheetFrameSize? = null,
    val visualScale: Double? = null,
)

@Serializable
data class SheetRevisionResponse(
    val sheetId: String,
    val revision: Long,
)

@Serializable
data class CellRevisionRequest(val sheetId: String, val revision: Long)

@Serializable
data class CellWriteRequest(val sheetId: String, val rowId: String, val columnId: String, val raw: String)

@Serializable
data class CellPatchRequest(
    val expectedRevisions: List<CellRevisionRequest>,
    val cells: List<CellWriteRequest>,
)

@Serializable
data class CellPatchResponse(val sheets: List<SheetRevisionResponse>)

@Serializable
data class SheetZOrderUpdateRequest(
    val sheetId: String,
    val expectedRevision: Long,
    val zIndex: Int,
)

@Serializable
data class UpdateSheetZOrderRequest(val updates: List<SheetZOrderUpdateRequest>)

@Serializable
data class UpdateSheetZOrderResponse(val sheets: List<SheetRevisionResponse>)

@Serializable
data class RowAppendResponse(
    val sheetId: String,
    val revision: Long,
    val rowCount: Int,
    val rowId: String,
)

@Serializable
data class ColumnAppendResponse(
    val sheetId: String,
    val revision: Long,
    val columnCount: Int,
    val columnId: String,
)

@Serializable
data class ErrorResponse(val error: String)

fun Application.configureHttp(workbookApplication: WorkbookApplication) {
    install(ContentNegotiation) {
        json()
    }

    routing {
        get("/api/health") {
            call.respond(HealthService().health())
        }

        get("/api/workbook") {
            call.respond(WorkbookReadTransportAdapter.manifest(workbookApplication.loadManifest()))
        }

        get("/api/workbook/bundle") {
            call.respond(WorkbookReadTransportAdapter.bundle(workbookApplication.loadWorkbookBundle()))
        }

        get("/api/sheets/{sheetId}") {
            val sheetId = call.parameters["sheetId"] ?: return@get call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            call.respondApplicationResult {
                call.respond(
                    WorkbookReadTransportAdapter.sheetDocument(workbookApplication.loadSheet(sheetId)),
                )
            }
        }

        post("/api/sheets") {
            val request = call.receiveRequest<CreateSheetRequest>() ?: return@post
            call.respondApplicationResult {
                val sheet = workbookApplication.createSheet(
                    CreateSheetCommand(
                        name = request.name,
                        position = request.position,
                        frameSize = request.frameSize,
                        visualScale = request.visualScale,
                        zIndex = request.zIndex,
                    ),
                )
                call.respond(
                    HttpStatusCode.Created,
                    WorkbookReadTransportAdapter.sheetDocument(sheet),
                )
            }
        }

        patch("/api/sheets/{sheetId}") {
            val sheetId = call.parameters["sheetId"] ?: return@patch call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            val request = call.receiveRequest<UpdateSheetRequest>() ?: return@patch
            val expectedRevision = call.expectedSheetRevision() ?: return@patch
            call.respondApplicationResult {
                val sheet = workbookApplication.updateSheet(
                    sheetId,
                    expectedRevision,
                    UpdateSheetCommand(
                        name = request.name,
                        position = request.position,
                        frameSize = request.frameSize,
                        visualScale = request.visualScale,
                    ),
                )
                call.respond(SheetRevisionResponse(sheet.id.value, sheet.revision))
            }
        }

        patch("/api/sheets/{sheetId}/presentation") {
            val sheetId = call.parameters["sheetId"] ?: return@patch call.respondError(HttpStatusCode.BadRequest, "sheet-id-required")
            val request = call.receivePresentationWriteRequest() ?: return@patch
            val expectedRevision = call.expectedSheetRevision() ?: return@patch
            call.respondApplicationResult {
                val sheet = workbookApplication.writePresentation(sheetId, expectedRevision, request.writes, request.formatWrites)
                call.respond(SheetRevisionResponse(sheet.id.value, sheet.revision))
            }
        }

        patch("/api/workbook/sheet-z-order") {
            val request = call.receiveRequest<UpdateSheetZOrderRequest>() ?: return@patch
            call.respondApplicationResult {
                val sheets = workbookApplication.updateSheetZOrder(
                    request.updates.map { update ->
                        SheetZOrderUpdate(update.sheetId, update.expectedRevision, update.zIndex)
                    },
                )
                call.respond(
                    UpdateSheetZOrderResponse(
                        sheets.map { sheet -> SheetRevisionResponse(sheet.id.value, sheet.revision) },
                    ),
                )
            }
        }

        delete("/api/sheets/{sheetId}") {
            val sheetId = call.parameters["sheetId"] ?: return@delete call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            if (!call.requireExistingSheet(workbookApplication, sheetId)) return@delete
            val expectedRevision = call.expectedSheetRevision() ?: return@delete
            call.respondApplicationResult {
                workbookApplication.deleteSheet(sheetId, expectedRevision)
                call.respond(HttpStatusCode.NoContent)
            }
        }

        patch("/api/cells") {
            val request = call.receiveRequest<CellPatchRequest>() ?: return@patch
            call.respondApplicationResult {
                val sheets = workbookApplication.writeCells(
                    CellPatchCommand(
                        request.expectedRevisions.map { ExpectedSheetRevision(it.sheetId, it.revision) },
                        request.cells.map { SheetCellWrite(it.sheetId, it.rowId, it.columnId, it.raw) },
                    ),
                )
                call.respond(CellPatchResponse(sheets.map { SheetRevisionResponse(it.id.value, it.revision) }))
            }
        }

        post("/api/sheets/{sheetId}/rows") {
            val sheetId = call.parameters["sheetId"] ?: return@post call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            if (!call.requireExistingSheet(workbookApplication, sheetId)) return@post
            val expectedRevision = call.expectedSheetRevision() ?: return@post
            call.respondApplicationResult {
                val result = workbookApplication.appendRow(sheetId, expectedRevision)
                call.respond(
                    RowAppendResponse(
                        result.sheet.id.value,
                        result.sheet.revision,
                        result.sheet.tabularContent.rowCount,
                        result.rowId.value,
                    ),
                )
            }
        }

        post("/api/sheets/{sheetId}/columns") {
            val sheetId = call.parameters["sheetId"] ?: return@post call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            if (!call.requireExistingSheet(workbookApplication, sheetId)) return@post
            val expectedRevision = call.expectedSheetRevision() ?: return@post
            call.respondApplicationResult {
                val result = workbookApplication.appendColumn(sheetId, expectedRevision)
                call.respond(
                    ColumnAppendResponse(
                        result.sheet.id.value,
                        result.sheet.revision,
                        result.sheet.tabularContent.columnCount,
                        result.columnId.value,
                    ),
                )
            }
        }

        staticResources("/", "static") {
            default("index.html")
        }
    }
}

private suspend fun ApplicationCall.requireExistingSheet(
    application: WorkbookApplication,
    sheetId: String,
): Boolean {
    return try {
        application.loadSheet(sheetId)
        true
    } catch (rejection: WorkbookApplicationException) {
        respondApplicationError(rejection.error)
        false
    }
}

private suspend fun ApplicationCall.respondApplicationResult(response: suspend () -> Unit) {
    try {
        response()
    } catch (conflict: SheetRevisionConflict) {
        respondError(HttpStatusCode.Conflict, "sheet-revision-conflict")
    } catch (rejection: WorkbookApplicationException) {
        respondApplicationError(rejection.error)
    }
}

private suspend fun ApplicationCall.respondApplicationError(error: WorkbookApplicationError) {
    val (status, code) = when (error) {
        WorkbookApplicationError.SHEET_NOT_FOUND -> HttpStatusCode.NotFound to "sheet-not-found"
        WorkbookApplicationError.SHEET_NAME_REQUIRED -> HttpStatusCode.BadRequest to "sheet-name-required"
        WorkbookApplicationError.SHEET_NAME_DUPLICATE -> HttpStatusCode.BadRequest to "sheet-name-duplicate"
        WorkbookApplicationError.SHEET_UPDATE_REQUIRED -> HttpStatusCode.BadRequest to "sheet-update-required"
        WorkbookApplicationError.INVALID_SHEET_POSITION -> HttpStatusCode.BadRequest to "invalid-sheet-position"
        WorkbookApplicationError.INVALID_SHEET_FRAME_SIZE ->
            HttpStatusCode.BadRequest to "invalid-sheet-frame-size"
        WorkbookApplicationError.INVALID_SHEET_VISUAL_SCALE ->
            HttpStatusCode.BadRequest to "invalid-sheet-visual-scale"
        WorkbookApplicationError.INVALID_SHEET_Z_INDEX -> HttpStatusCode.BadRequest to "invalid-sheet-z-index"
        WorkbookApplicationError.SHEET_Z_ORDER_UPDATE_REQUIRED ->
            HttpStatusCode.BadRequest to "sheet-z-order-update-required"
        WorkbookApplicationError.DUPLICATE_SHEET_Z_ORDER_UPDATE ->
            HttpStatusCode.BadRequest to "duplicate-sheet-z-order-update"
        WorkbookApplicationError.INVALID_SHEET_PRESENTATION -> HttpStatusCode.BadRequest to "invalid-sheet-presentation"
        WorkbookApplicationError.EMPTY_CELL_PATCH -> HttpStatusCode.BadRequest to "empty-cell-patch"
        WorkbookApplicationError.DUPLICATE_CELL_WRITE -> HttpStatusCode.BadRequest to "duplicate-cell-write"
        WorkbookApplicationError.DUPLICATE_SHEET_REVISION -> HttpStatusCode.BadRequest to "duplicate-sheet-revision"
        WorkbookApplicationError.INVALID_CELL_COORDINATE -> HttpStatusCode.BadRequest to "invalid-cell-coordinate"
        WorkbookApplicationError.INVALID_CELL_PATCH -> HttpStatusCode.BadRequest to "invalid-cell-patch"
    }
    respondError(status, code)
}

private suspend fun ApplicationCall.respondError(status: HttpStatusCode, error: String) {
    respond(status, ErrorResponse(error))
}

private suspend fun ApplicationCall.expectedSheetRevision(): Long? {
    val header = request.headers["If-Match"]?.trim()
    if (header.isNullOrEmpty()) {
        respondError(HttpStatusCode.BadRequest, "sheet-revision-required")
        return null
    }
    return header.toLongOrNull() ?: run {
        respondError(HttpStatusCode.BadRequest, "invalid-sheet-revision")
        null
    }
}

private suspend inline fun <reified T : Any> ApplicationCall.receiveRequest(): T? {
    return try {
        receive<T>()
    } catch (exception: Exception) {
        respondError(HttpStatusCode.BadRequest, "invalid-request")
        null
    }
}

private suspend fun ApplicationCall.receivePresentationWriteRequest(): PresentationWriteRequest? {
    return try {
        val body = receiveText()
        if (hasDuplicateAppearanceProperties(body)) error("Duplicate appearance property")
        Json.decodeFromString<PresentationWriteRequest>(body)
    } catch (exception: Exception) {
        respondError(HttpStatusCode.BadRequest, "invalid-request")
        null
    }
}

/** Retain duplicate property names long enough to reject them before map decoding collapses them. */
private fun hasDuplicateAppearanceProperties(body: String): Boolean =
    Regex("""(?s)"properties"\s*:\s*\{((?:[^{}]|\{[^{}]*})*)}""").findAll(body).any { properties ->
        val names = Regex(""""([^"\\]+)"\s*:""").findAll(properties.groupValues[1]).map { it.groupValues[1] }.toList()
        names.distinct().size != names.size
    }
