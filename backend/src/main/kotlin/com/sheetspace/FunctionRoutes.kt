package com.sheetspace

import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import io.ktor.server.routing.put

internal fun Route.functionRoutes(workbookApplication: WorkbookApplication) {
    put("/api/workbook/functions") {
        val request = call.receiveRequest<FunctionWriteRequest>() ?: return@put
        call.respondApplicationResult {
            call.respond(workbookApplication.admitFunctionWrite(request))
        }
    }
    post("/api/workbook/functions/delete") {
        val request = call.receiveRequest<FunctionDeleteRequest>() ?: return@post
        call.respondApplicationResult {
            call.respond(workbookApplication.admitFunctionDelete(request))
        }
    }
}
