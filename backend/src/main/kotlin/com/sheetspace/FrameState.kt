package com.sheetspace

import kotlinx.serialization.Serializable

@Serializable
data class WorkspacePosition(
    val x: Double = 0.0,
    val y: Double = 0.0,
) {
    fun isValid(): Boolean = x.isFinite() && y.isFinite()
}

@Serializable
data class SheetFrameSize(
    val width: Double = DEFAULT_SHEET_FRAME_WIDTH,
    val height: Double = DEFAULT_SHEET_FRAME_HEIGHT,
) {
    fun isValid(): Boolean =
        width.isFinite() && height.isFinite() && width > 0.0 && height > 0.0
}

data class FrameState(
    val position: WorkspacePosition = WorkspacePosition(),
    val size: SheetFrameSize = SheetFrameSize(),
    val zIndex: Int = 1,
) {
    fun isValid(): Boolean = position.isValid() && size.isValid() && zIndex >= 1

    fun update(
        position: WorkspacePosition? = null,
        size: SheetFrameSize? = null,
        zIndex: Int? = null,
    ): FrameState = copy(
        position = position ?: this.position,
        size = size ?: this.size,
        zIndex = zIndex ?: this.zIndex,
    )
}
