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
    val id: String,
    val name: String,
    val position: WorkspacePosition = WorkspacePosition(),
)

@Serializable
data class UpdateCellRequest(val raw: String)

@Serializable
data class UpdateSheetRequest(
    val name: String? = null,
    val position: WorkspacePosition? = null,
)

@Serializable
data class MutationResponse(
    val ok: Boolean = true,
    val workbook: Workbook,
)

@Serializable
data class ErrorResponse(
    val ok: Boolean = false,
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
            call.respond(repository.loadWorkbook())
        }

        post("/api/sheets") {
            val request = call.receiveRequest<CreateSheetRequest>() ?: return@post
            val workbook = repository.loadWorkbook()
            val sheetId = request.id.trim()

            when {
                sheetId.isEmpty() -> call.respondError(HttpStatusCode.BadRequest, "sheet-id-required")
                workbook.sheets.any { it.id == sheetId } -> call.respondError(HttpStatusCode.Conflict, "sheet-id-duplicate")
                !request.position.isFinite() -> call.respondError(HttpStatusCode.BadRequest, "invalid-sheet-position")
                else -> when (val result = createSheet(sheetId, request.name, workbook.sheets, request.position)) {
                    is SheetNameResult.Invalid -> call.respondError(HttpStatusCode.BadRequest, result.reason.apiError)
                    is SheetNameResult.Valid -> {
                        val updated = repository.createSheet(result.value)
                        call.respond(HttpStatusCode.Created, MutationResponse(workbook = updated))
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

            when {
                sheet == null -> call.respondError(HttpStatusCode.NotFound, "sheet-not-found")
                request.name == null && requestedPosition == null -> call.respondError(
                    HttpStatusCode.BadRequest,
                    "sheet-update-required",
                )
                requestedPosition != null && !requestedPosition.isFinite() -> call.respondError(
                    HttpStatusCode.BadRequest,
                    "invalid-sheet-position",
                )
                request.name != null -> when (val validation = validateSheetName(request.name, workbook.sheets, sheetId)) {
                    is SheetNameResult.Invalid -> call.respondError(HttpStatusCode.BadRequest, validation.reason.apiError)
                    is SheetNameResult.Valid -> {
                        var updated = repository.renameSheet(sheetId, validation.value)
                        if (requestedPosition != null) {
                            updated = repository.updateSheetPosition(sheetId, requestedPosition)
                        }
                        call.respond(MutationResponse(workbook = updated))
                    }
                }
                else -> {
                    val updated = repository.updateSheetPosition(sheetId, requireNotNull(requestedPosition))
                    call.respond(MutationResponse(workbook = updated))
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

            when {
                sheet == null -> call.respondError(HttpStatusCode.NotFound, "sheet-not-found")
                !sheet.containsCell(cellAddress) -> call.respondError(HttpStatusCode.BadRequest, "invalid-cell-address")
                else -> {
                    val updated = repository.updateCell(sheetId, cellAddress, request.raw)
                    call.respond(MutationResponse(workbook = updated))
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
                val updated = repository.appendRow(sheetId)
                call.respond(MutationResponse(workbook = updated))
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
                val updated = repository.appendColumn(sheetId)
                call.respond(MutationResponse(workbook = updated))
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

private suspend inline fun <reified T : Any> ApplicationCall.receiveRequest(): T? {
    return try {
        receive<T>()
    } catch (exception: Exception) {
        respondError(HttpStatusCode.BadRequest, "invalid-request")
        null
    }
}

private val SheetNameError.apiError: String
    get() = when (this) {
        SheetNameError.EMPTY -> "sheet-name-required"
        SheetNameError.DUPLICATE -> "sheet-name-duplicate"
    }

private fun WorkspacePosition.isFinite(): Boolean {
    return x.isFinite() && y.isFinite()
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
