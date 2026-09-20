package com.sheetspace

import kotlinx.serialization.Serializable

const val MIN_SHEET_VISUAL_SCALE = 0.1
const val MAX_SHEET_VISUAL_SCALE = 8.0

fun isValidSheetVisualScale(value: Double): Boolean =
    value.isFinite() && value in MIN_SHEET_VISUAL_SCALE..MAX_SHEET_VISUAL_SCALE

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
    val visualScale: Double = 1.0,
    val zIndex: Int = 1,
) {
    fun isValid(): Boolean = position.isValid() && size.isValid() && isValidSheetVisualScale(visualScale) && zIndex >= 1

    fun update(
        position: WorkspacePosition? = null,
        size: SheetFrameSize? = null,
        visualScale: Double? = null,
        zIndex: Int? = null,
    ): FrameState = copy(
        position = position ?: this.position,
        size = size ?: this.size,
        visualScale = visualScale ?: this.visualScale,
        zIndex = zIndex ?: this.zIndex,
    )
}
