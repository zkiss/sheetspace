package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class WorkbookTransportContractTest {
    @Test
    fun `sheet command and revision transport values retain their serialized fields`() {
        val create = CreateSheetRequest("Inputs")
        val update = UpdateSheetRequest(name = "Outputs")
        val zOrder = SheetZOrderUpdateRequest("id", 3, 2)
        val response = SheetRevisionResponse("id", 3)

        assertEquals(create, create.copy())
        assertEquals("Inputs", create.component1())
        assertEquals(update, update.copy())
        assertEquals("Outputs", update.component1())
        assertEquals(zOrder, zOrder.copy())
        assertEquals("id", zOrder.component1())
        assertEquals(response, response.copy())
        assertTrue(response.toString().contains("SheetRevisionResponse"))
    }
}
