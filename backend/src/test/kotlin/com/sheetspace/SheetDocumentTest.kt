package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class SheetDocumentTest {
    @Test
    fun `new sheet uses backend identity and focused defaults`() {
        val result = createSheetDocument(
            name = " Inputs ",
            position = WorkspacePosition(12.0, 24.0),
        )

        val sheet = assertIs<SheetNameResult.Valid<SheetDocument>>(result).value
        UUID.fromString(sheet.id.value)
        assertEquals("Inputs", sheet.name)
        assertEquals(WorkspacePosition(12.0, 24.0), sheet.frame.position)
        assertEquals(FrameState(position = WorkspacePosition(12.0, 24.0)), sheet.frame)
        assertEquals(SheetContentKind.TABULAR, sheet.content.kind)
        assertEquals(DEFAULT_ROW_COUNT, sheet.tabularContent.rowCount)
        assertEquals(DEFAULT_COLUMN_COUNT, sheet.tabularContent.columnCount)
        assertEquals(emptyMap(), sheet.tabularContent.cells)
    }

    @Test
    fun `new sheets stack above existing frames`() {
        val first = assertIs<SheetNameResult.Valid<SheetDocument>>(
            createSheetDocument("Inputs"),
        ).value
        val second = assertIs<SheetNameResult.Valid<SheetDocument>>(
            createSheetDocument("Outputs", listOf(first)),
        ).value

        assertEquals(1, first.frame.zIndex)
        assertEquals(2, second.frame.zIndex)
    }

    @Test
    fun `sheet names must be non-empty and unique`() {
        val existing = SheetDocument(SheetId("sheet"), name = "Inputs")

        assertEquals(
            SheetNameResult.Invalid(SheetNameError.EMPTY),
            validateSheetName("   ", listOf(existing)),
        )
        assertEquals(
            SheetNameResult.Invalid(SheetNameError.DUPLICATE),
            validateSheetName("Inputs", listOf(existing)),
        )
        assertEquals(
            SheetNameResult.Valid("Inputs"),
            validateSheetName(" Inputs ", listOf(existing), existing.id),
        )
    }
}
