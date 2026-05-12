package com.sheetspace

import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.http.content.default
import io.ktor.server.http.content.staticResources
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import java.nio.file.Paths

private val workbookRepository by lazy {
    WorkbookRepository(Paths.get(System.getenv("SHEETSPACE_DB_PATH") ?: "sheetspace.db"))
}

@Serializable
data class HealthResponse(val status: String, val service: String)

fun Application.module(repository: WorkbookRepository = workbookRepository) {
    install(ContentNegotiation) {
        json()
    }

    repository

    routing {
        get("/api/health") {
            call.respond(HealthService().health())
        }

        staticResources("/", "static") {
            default("index.html")
        }
    }
}

fun main() {
    embeddedServer(Netty, port = 8080, host = "0.0.0.0", module = Application::module).start(wait = true)
}
