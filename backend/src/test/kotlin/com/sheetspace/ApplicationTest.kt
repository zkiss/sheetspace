package com.sheetspace

import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ApplicationTest {
    @Test
    fun `health endpoint returns ok payload`() = testApplication {
        application {
            module()
        }

        val response = client.get("/api/health")

        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        assertTrue(body.contains("\"status\":\"ok\""))
        assertTrue(body.contains("\"service\":\"sheetspace-api\""))
    }
}
