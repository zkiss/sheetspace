package com.sheetspace

class HealthService {
    fun health(): HealthResponse = HealthResponse(status = "ok", service = "sheetspace-api")
}
