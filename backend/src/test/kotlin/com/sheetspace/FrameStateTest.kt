package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FrameStateTest {
    @Test
    fun `frame validation owns position size and stacking rules`() {
        assertTrue(FrameState().isValid())
        assertFalse(FrameState(position = WorkspacePosition(Double.NaN, 0.0)).isValid())
        assertFalse(FrameState(size = SheetFrameSize(0.0, 1.0)).isValid())
        assertFalse(FrameState(zIndex = 0).isValid())
    }

    @Test
    fun `frame update changes only requested frame fields`() {
        val original = FrameState(
            position = WorkspacePosition(1.0, 2.0),
            size = SheetFrameSize(300.0, 200.0),
            zIndex = 4,
        )

        assertEquals(
            original.copy(position = WorkspacePosition(8.0, 9.0)),
            original.update(position = WorkspacePosition(8.0, 9.0)),
        )
    }
}
