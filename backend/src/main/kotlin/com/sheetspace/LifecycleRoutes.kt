package com.sheetspace

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.call
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import io.ktor.server.routing.put

internal fun Route.lifecycleRoutes(workbookApplication: WorkbookApplication) {
    put("/api/workbook/model-lifecycle") {
        val request = call.receiveRequest<ModelLifecycleRequest>("invalid-model-lifecycle") ?: return@put
        call.respondApplicationResult {
            call.respond(workbookApplication.saveModelLifecycle(request))
        }
    }

    post("/api/workbook/model-lifecycle/{transitionId}/replay") {
        val transitionId = call.parameters["transitionId"] ?: return@post call.respondError(HttpStatusCode.BadRequest, "invalid-model-lifecycle")
        val request = call.receiveRequest<LifecycleReplayRequest>("invalid-model-lifecycle") ?: return@post
        call.respondApplicationResult { call.respond(workbookApplication.replayLifecycle(transitionId, request)) }
    }
}
