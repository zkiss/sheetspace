package com.sheetspace

import kotlinx.serialization.Serializable

@Serializable
data class WorkbookManifestResponse(
    val version: Int,
    val revision: Long,
    val sheetIds: List<String>,
)

@Serializable
data class WorkbookBundleResponse(
    val manifest: WorkbookManifestResponse,
    val documents: List<SheetDocumentResponse>,
)

@Serializable
data class SheetDocumentResponse(
    val id: String,
    val revision: Long,
    val name: String,
    val frame: FrameStateResponse,
    val content: TabularContentResponse,
)

@Serializable
data class FrameStateResponse(
    val position: WorkspacePosition,
    val size: SheetFrameSize,
    val zIndex: Int,
)

@Serializable
data class TabularContentResponse(
    val kind: String,
    val rows: List<String>,
    val columns: List<String>,
    val cells: List<CellContentResponse>,
)

@Serializable
data class CellContentResponse(
    val rowId: String,
    val columnId: String,
    val content: String,
)

internal object WorkbookReadTransportAdapter {
    fun manifest(manifest: WorkbookManifest): WorkbookManifestResponse = WorkbookManifestResponse(
        version = manifest.version,
        revision = manifest.revision,
        sheetIds = manifest.sheetIds.map { it.value },
    )

    fun bundle(workbook: WorkbookState): WorkbookBundleResponse = WorkbookBundleResponse(
        manifest = manifest(workbook.manifest),
        documents = workbook.sheetsInOrder.map(::sheetDocument),
    )

    fun sheetDocument(document: SheetDocument): SheetDocumentResponse {
        val tabular = document.tabularContent
        val rowOrder = tabular.rows.withIndex().associate { (index, id) -> id to index }
        val columnOrder = tabular.columns.withIndex().associate { (index, id) -> id to index }
        return SheetDocumentResponse(
            id = document.id.value,
            revision = document.revision,
            name = document.name,
            frame = FrameStateResponse(
                position = document.frame.position,
                size = document.frame.size,
                zIndex = document.frame.zIndex,
            ),
            content = TabularContentResponse(
                kind = "tabular",
                rows = tabular.rows.map { it.value },
                columns = tabular.columns.map { it.value },
                cells = tabular.cellContents.entries
                    .sortedWith(
                        compareBy(
                            { rowOrder.getValue(it.key.rowId) },
                            { columnOrder.getValue(it.key.columnId) },
                        ),
                    )
                    .map { (coordinate, content) ->
                        CellContentResponse(
                            rowId = coordinate.rowId.value,
                            columnId = coordinate.columnId.value,
                            content = content,
                        )
                    },
            ),
        )
    }
}
