package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals

class HealthServiceTest {
    @Test
    fun `health returns expected payload`() {
        val payload = HealthService().health()

        assertEquals("ok", payload.status)
        assertEquals("sheetspace-api", payload.service)
    }
}
