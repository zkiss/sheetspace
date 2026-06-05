package com.sheetspace

import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.request.receive
import io.ktor.server.engine.embeddedServer
import io.ktor.server.http.content.default
import io.ktor.server.http.content.staticResources
import io.ktor.server.response.respond
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.routing.patch
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.routing
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.Serializable
import java.nio.file.Paths

private val workbookRepository by lazy {
    WorkbookRepository(Paths.get(System.getenv("SHEETSPACE_DB_PATH") ?: "sheetspace.db"))
}

@Serializable
data class HealthResponse(val status: String, val service: String)

@Serializable
data class CreateSheetRequest(
    val name: String,
    val position: WorkspacePosition = WorkspacePosition(),
    val frameSize: SheetFrameSize = SheetFrameSize(),
    val zIndex: Int? = null,
)

@Serializable
data class UpdateCellRequest(
    val raw: String,
    val sheetReferences: List<FormulaSheetReference> = emptyList(),
)

@Serializable
data class UpdateSheetRequest(
    val name: String? = null,
    val position: WorkspacePosition? = null,
    val frameSize: SheetFrameSize? = null,
    val zIndex: Int? = null,
)

@Serializable
data class SheetRevisionResponse(
    val sheetId: String,
    val revision: Long,
)

@Serializable
data class RowAppendResponse(
    val sheetId: String,
    val revision: Long,
    val rowCount: Int,
)

@Serializable
data class ColumnAppendResponse(
    val sheetId: String,
    val revision: Long,
    val columnCount: Int,
)

@Serializable
data class ErrorResponse(
    val error: String,
)

fun Application.module(repository: WorkbookRepository = workbookRepository) {
    install(ContentNegotiation) {
        json()
    }

    repository

    routing {
        get("/api/health") {
            call.respond(HealthService().health())
        }

        get("/api/workbook") {
            val workbook = repository.loadWorkbook()
            call.respond(WorkbookSummary(version = workbook.version, sheetIds = workbook.sheets.map { it.id }))
        }

        get("/api/sheets/{sheetId}") {
            val sheetId = call.parameters["sheetId"] ?: return@get call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            val sheet = repository.loadWorkbook().sheets.find { it.id == sheetId }
            if (sheet == null) {
                call.respondError(HttpStatusCode.NotFound, "sheet-not-found")
            } else {
                call.respond(sheet)
            }
        }

        post("/api/sheets") {
            val request = call.receiveRequest<CreateSheetRequest>() ?: return@post
            val workbook = repository.loadWorkbook()

            when {
                !request.position.isFinite() -> call.respondError(HttpStatusCode.BadRequest, "invalid-sheet-position")
                !request.frameSize.isValid() -> call.respondError(HttpStatusCode.BadRequest, "invalid-sheet-frame-size")
                request.zIndex != null && request.zIndex < 1 -> call.respondError(HttpStatusCode.BadRequest, "invalid-sheet-z-index")
                else -> when (
                    val result = createSheet(
                        name = request.name,
                        existingSheets = workbook.sheets,
                        position = request.position,
                        frameSize = request.frameSize,
                        zIndex = request.zIndex,
                    )
                ) {
                    is SheetNameResult.Invalid -> call.respondError(HttpStatusCode.BadRequest, result.reason.apiError)
                    is SheetNameResult.Valid -> {
                        try {
                            val updated = repository.createSheet(
                                result.value,
                                assignDefaultZIndex = request.zIndex == null,
                            )
                            call.respond(HttpStatusCode.Created, updated.sheets.single { it.id == result.value.id })
                        } catch (rejection: SheetNameRejected) {
                            call.respondError(HttpStatusCode.BadRequest, rejection.reason.apiError)
                        }
                    }
                }
            }
        }

        patch("/api/sheets/{sheetId}") {
            val sheetId = call.parameters["sheetId"] ?: return@patch call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            val request = call.receiveRequest<UpdateSheetRequest>() ?: return@patch
            val workbook = repository.loadWorkbook()
            val sheet = workbook.sheets.find { it.id == sheetId }
            val requestedPosition = request.position
            val requestedFrameSize = request.frameSize
            val requestedZIndex = request.zIndex
            val expectedRevision = call.expectedSheetRevision() ?: return@patch

            when {
                sheet == null -> call.respondError(HttpStatusCode.NotFound, "sheet-not-found")
                request.name == null &&
                    requestedPosition == null &&
                    requestedFrameSize == null &&
                    requestedZIndex == null -> call.respondError(
                    HttpStatusCode.BadRequest,
                    "sheet-update-required",
                )
                requestedPosition != null && !requestedPosition.isFinite() -> call.respondError(
                    HttpStatusCode.BadRequest,
                    "invalid-sheet-position",
                )
                requestedFrameSize != null && !requestedFrameSize.isValid() -> call.respondError(
                    HttpStatusCode.BadRequest,
                    "invalid-sheet-frame-size",
                )
                requestedZIndex != null && requestedZIndex < 1 -> call.respondError(
                    HttpStatusCode.BadRequest,
                    "invalid-sheet-z-index",
                )
                request.name != null -> {
                    call.respondSheetRevision(sheetId) {
                        repository.updateSheet(
                            sheetId = sheetId,
                            expectedRevision = expectedRevision,
                            name = request.name,
                            position = requestedPosition,
                            frameSize = requestedFrameSize,
                            zIndex = requestedZIndex,
                        )
                    }
                }
                requestedPosition != null || requestedFrameSize != null -> {
                    call.respondSheetRevision(sheetId) {
                        repository.updateSheet(
                            sheetId = sheetId,
                            expectedRevision = expectedRevision,
                            position = requestedPosition,
                            frameSize = requestedFrameSize,
                            zIndex = requestedZIndex,
                        )
                    }
                }
                else -> {
                    call.respondSheetRevision(sheetId) {
                        repository.updateSheet(
                            sheetId = sheetId,
                            expectedRevision = expectedRevision,
                            zIndex = requireNotNull(requestedZIndex),
                        )
                    }
                }
            }
        }

        delete("/api/sheets/{sheetId}") {
            val sheetId = call.parameters["sheetId"] ?: return@delete call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            val workbook = repository.loadWorkbook()
            if (workbook.sheets.none { it.id == sheetId }) {
                call.respondError(HttpStatusCode.NotFound, "sheet-not-found")
            } else {
                val expectedRevision = call.expectedSheetRevision() ?: return@delete
                call.respondDelete {
                    repository.deleteSheet(sheetId, expectedRevision)
                }
            }
        }

        put("/api/sheets/{sheetId}/cells/{cellAddress}") {
            val sheetId = call.parameters["sheetId"] ?: return@put call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            val cellAddress = call.parameters["cellAddress"] ?: return@put call.respondError(
                HttpStatusCode.BadRequest,
                "cell-address-required",
            )
            val request = call.receiveRequest<UpdateCellRequest>() ?: return@put
            val workbook = repository.loadWorkbook()
            val sheet = workbook.sheets.find { it.id == sheetId }
            val expectedRevision = call.expectedSheetRevision() ?: return@put

            when {
                sheet == null -> call.respondError(HttpStatusCode.NotFound, "sheet-not-found")
                !sheet.containsCell(cellAddress) -> call.respondError(HttpStatusCode.BadRequest, "invalid-cell-address")
                !request.raw.hasValidSheetReferenceSpans(request.sheetReferences) -> call.respondError(
                    HttpStatusCode.BadRequest,
                    "invalid-sheet-reference-spans",
                )
                else -> {
                    call.respondSheetRevision(sheetId) {
                        repository.updateCell(
                            sheetId,
                            cellAddress,
                            request.raw,
                            expectedRevision,
                            request.sheetReferences,
                        )
                    }
                }
            }
        }

        post("/api/sheets/{sheetId}/rows") {
            val sheetId = call.parameters["sheetId"] ?: return@post call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            val workbook = repository.loadWorkbook()
            if (workbook.sheets.none { it.id == sheetId }) {
                call.respondError(HttpStatusCode.NotFound, "sheet-not-found")
            } else {
                val expectedRevision = call.expectedSheetRevision() ?: return@post
                call.respondRowAppend(sheetId) {
                    repository.appendRow(sheetId, expectedRevision)
                }
            }
        }

        post("/api/sheets/{sheetId}/columns") {
            val sheetId = call.parameters["sheetId"] ?: return@post call.respondError(
                HttpStatusCode.BadRequest,
                "sheet-id-required",
            )
            val workbook = repository.loadWorkbook()
            if (workbook.sheets.none { it.id == sheetId }) {
                call.respondError(HttpStatusCode.NotFound, "sheet-not-found")
            } else {
                val expectedRevision = call.expectedSheetRevision() ?: return@post
                call.respondColumnAppend(sheetId) {
                    repository.appendColumn(sheetId, expectedRevision)
                }
            }
        }

        staticResources("/", "static") {
            default("index.html")
        }
    }
}

fun main() {
    embeddedServer(Netty, port = 8080, host = "0.0.0.0", module = Application::module).start(wait = true)
}

private suspend fun ApplicationCall.respondError(status: HttpStatusCode, error: String) {
    respond(status, ErrorResponse(error = error))
}

private suspend fun ApplicationCall.respondSheetRevision(sheetId: String, update: () -> Workbook) {
    try {
        val sheet = update().sheets.single { it.id == sheetId }
        respond(SheetRevisionResponse(sheetId = sheet.id, revision = sheet.revision))
    } catch (conflict: SheetRevisionConflict) {
        respondError(HttpStatusCode.Conflict, "sheet-revision-conflict")
    } catch (rejection: SheetNameRejected) {
        respondError(HttpStatusCode.BadRequest, rejection.reason.apiError)
    } catch (unknown: UnknownSheetUpdate) {
        respondError(HttpStatusCode.NotFound, "sheet-not-found")
    }
}

private suspend fun ApplicationCall.respondRowAppend(sheetId: String, update: () -> Workbook) {
    try {
        val sheet = update().sheets.single { it.id == sheetId }
        respond(RowAppendResponse(sheetId = sheet.id, revision = sheet.revision, rowCount = sheet.rowCount))
    } catch (conflict: SheetRevisionConflict) {
        respondError(HttpStatusCode.Conflict, "sheet-revision-conflict")
    } catch (unknown: UnknownSheetUpdate) {
        respondError(HttpStatusCode.NotFound, "sheet-not-found")
    }
}

private suspend fun ApplicationCall.respondColumnAppend(sheetId: String, update: () -> Workbook) {
    try {
        val sheet = update().sheets.single { it.id == sheetId }
        respond(ColumnAppendResponse(sheetId = sheet.id, revision = sheet.revision, columnCount = sheet.columnCount))
    } catch (conflict: SheetRevisionConflict) {
        respondError(HttpStatusCode.Conflict, "sheet-revision-conflict")
    } catch (unknown: UnknownSheetUpdate) {
        respondError(HttpStatusCode.NotFound, "sheet-not-found")
    }
}

private suspend fun ApplicationCall.respondDelete(update: () -> Workbook) {
    try {
        update()
        respond(HttpStatusCode.NoContent)
    } catch (conflict: SheetRevisionConflict) {
        respondError(HttpStatusCode.Conflict, "sheet-revision-conflict")
    } catch (unknown: UnknownSheetUpdate) {
        respondError(HttpStatusCode.NotFound, "sheet-not-found")
    }
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

private fun String.hasValidSheetReferenceSpans(references: List<FormulaSheetReference>): Boolean {
    if (references.isNotEmpty() && !startsWith("=")) {
        return false
    }

    var previousEndIndex = -1
    for (reference in references.sortedBy { it.startIndex }) {
        if (
            reference.startIndex < 0 ||
            reference.endIndex <= reference.startIndex ||
            reference.endIndex > length ||
            reference.startIndex < previousEndIndex ||
            !hasSheetReferenceTokenBoundaryBefore(reference.startIndex) ||
            !hasValidSheetReferenceToken(substring(reference.startIndex, reference.endIndex)) ||
            !hasSheetReferenceSeparatorAndAddressAfter(reference.endIndex)
        ) {
            return false
        }
        previousEndIndex = reference.endIndex
    }

    return true
}

private fun String.hasSheetReferenceTokenBoundaryBefore(tokenStartIndex: Int): Boolean {
    val boundaryIndex = (tokenStartIndex - 1 downTo 0).firstOrNull { !this[it].isWhitespace() } ?: return false
    return this[boundaryIndex] in "(,:"
}

private fun String.hasSheetReferenceSeparatorAndAddressAfter(tokenEndIndex: Int): Boolean {
    val separatorIndex = (tokenEndIndex until length).firstOrNull { !this[it].isWhitespace() } ?: return false
    if (this[separatorIndex] != '!') {
        return false
    }

    val referenceStart = (separatorIndex + 1 until length).firstOrNull { !this[it].isWhitespace() } ?: return false
    val address = Regex("[A-Za-z]+[1-9][0-9]*").find(this, referenceStart) ?: return false
    if (address.range.first != referenceStart) {
        return false
    }

    val nextChar = getOrNull(address.range.last + 1)
    return nextChar == null || nextChar.isWhitespace() || nextChar in ":,)"
}

private fun hasValidSheetReferenceToken(token: String): Boolean {
    val trimmedToken = token.trim()
    if (!trimmedToken.startsWith("'")) {
        return trimmedToken.isNotEmpty() && trimmedToken.none { char -> char in "'(),:!" }
    }
    if (!trimmedToken.endsWith("'") || trimmedToken.length < 3) {
        return false
    }

    val inner = trimmedToken.substring(1, trimmedToken.length - 1)
    var cursor = 0
    while (cursor < inner.length) {
        if (inner[cursor] != '\'') {
            cursor += 1
            continue
        }
        if (cursor + 1 >= inner.length || inner[cursor + 1] != '\'') {
            return false
        }
        cursor += 2
    }
    return true
}

private val SheetNameError.apiError: String
    get() = when (this) {
        SheetNameError.EMPTY -> "sheet-name-required"
        SheetNameError.DUPLICATE -> "sheet-name-duplicate"
    }

private fun WorkspacePosition.isFinite(): Boolean {
    return x.isFinite() && y.isFinite()
}

private fun SheetFrameSize.isValid(): Boolean {
    return width.isFinite() && height.isFinite() && width > 0.0 && height > 0.0
}

private fun Sheet.containsCell(address: String): Boolean {
    val match = Regex("^([A-Z]+)([1-9][0-9]*)$").matchEntire(address) ?: return false
    val column = match.groupValues[1].columnIndex() ?: return false
    val row = match.groupValues[2].toIntOrNull() ?: return false
    return row in 1..rowCount && column in 1..columnCount
}

private fun String.columnIndex(): Int? {
    var result = 0
    for (char in this) {
        result = result * 26 + (char - 'A' + 1)
        if (result < 1) {
            return null
        }
    }
    return result
}
