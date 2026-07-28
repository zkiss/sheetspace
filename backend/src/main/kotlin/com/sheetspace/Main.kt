package com.sheetspace

import io.ktor.server.application.Application
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import java.nio.file.Paths

private val defaultWorkbookApplication by lazy {
    DefaultWorkbookApplication(
        SqliteWorkbookStore(Paths.get(System.getenv("SHEETSPACE_DB_PATH") ?: "sheetspace.db")),
    )
}

fun Application.module(workbookApplication: WorkbookApplication = defaultWorkbookApplication) {
    configureHttp(workbookApplication)
}

fun main() {
    embeddedServer(Netty, port = 8080, host = "0.0.0.0", module = Application::module).start(wait = true)
}
