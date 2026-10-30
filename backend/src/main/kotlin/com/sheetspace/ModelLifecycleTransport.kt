package com.sheetspace

import kotlinx.serialization.Serializable

@Serializable
data class ModelLifecycleRequest(val before: WorkbookBundleResponse, val after: WorkbookBundleResponse)

internal fun WorkbookBundleResponse.toLifecycleWorkbook(): WorkbookState = try {
    require(documents.map { it.id }.distinct().size == documents.size && dataModels.map { it.id }.distinct().size == dataModels.size)
    WorkbookState(
        manifest = WorkbookManifest(manifest.version, manifest.revision, manifest.sheetIds.map(::SheetId)),
        documents = documents.associate { document ->
            val content = document.content
            require(content.kind == "tabular" && content.cells.map { it.rowId to it.columnId }.distinct().size == content.cells.size && content.cells.none { it.content.isEmpty() })
            val sheet = SheetDocument(
                id = SheetId(document.id), revision = document.revision, name = document.name,
                frame = document.frame.let { FrameState(it.position, it.size, it.visualScale, it.zIndex) },
                presentation = document.presentation.let { SheetPresentation(it.rowHeights, it.columnWidths, it.formatOverrides) },
                content = TabularContent(content.rows.map(::RowId), content.columns.map(::ColumnId), content.cells.associate { CellCoordinate(RowId(it.rowId), ColumnId(it.columnId)) to it.content }),
                modelId = document.modelId,
                modelColumnBindings = document.modelColumnBindings.mapValues { ColumnId(it.value) },
                modelFormulaBindings = document.modelFormulaBindings,
                columnNames = document.columnNames,
            )
            sheet.id to sheet
        },
        dataModels = dataModels.associate { model ->
            val converted = DataModelWriteRequest(model.name, model.columns.map { ModelColumnWriteRequest(it.id, it.name, it.kind, it.type, it.formula) }).toDataModel(model.id)
            requireNotNull(converted)
            model.id to converted
        },
    )
} catch (invalid: IllegalArgumentException) {
    throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
}
