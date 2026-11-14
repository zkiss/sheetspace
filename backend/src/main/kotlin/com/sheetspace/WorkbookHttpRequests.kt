package com.sheetspace

import kotlinx.serialization.Serializable

@Serializable
data class HealthResponse(val status: String, val service: String)

@Serializable
data class FunctionWriteRequest(val operationId: String, val before: WorkbookBundleResponse, val declaration: CustomFunction, val previousName: String? = null)

@Serializable
data class FunctionDeleteRequest(val operationId: String, val before: WorkbookBundleResponse, val name: String)

@Serializable
data class CreateSheetRequest(
    val name: String,
    val position: WorkspacePosition = WorkspacePosition(),
    val frameSize: SheetFrameSize = SheetFrameSize(),
    val visualScale: Double = DEFAULT_SHEET_VISUAL_SCALE,
    val zIndex: Int? = null,
)
