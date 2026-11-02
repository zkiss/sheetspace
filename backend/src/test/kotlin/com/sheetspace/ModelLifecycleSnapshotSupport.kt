package com.sheetspace

internal const val EXTRACTION_SOURCE = "40000000-0000-0000-0000-000000000001"
internal const val EXTRACTION_TARGET = "40000000-0000-0000-0000-000000000002"
internal const val EXTRACTION_OTHER = "40000000-0000-0000-0000-000000000003"

internal val EXTRACTION_ROW_ONE = RowId("41000000-0000-0000-0000-000000000001")
internal val EXTRACTION_ROW_TWO = RowId("41000000-0000-0000-0000-000000000002")
internal val EXTRACTION_STAYING = ColumnId("42000000-0000-0000-0000-000000000001")
internal val EXTRACTION_MOVING = ColumnId("42000000-0000-0000-0000-000000000002")
internal val EXTRACTION_REMAINING = ColumnId("42000000-0000-0000-0000-000000000003")
internal val EXTRACTION_OTHER_COLUMN = ColumnId("42000000-0000-0000-0000-000000000004")

internal fun extractionWorkbook(): WorkbookState {
    val source = SheetDocument(
        id = SheetId(EXTRACTION_SOURCE),
        name = "Source",
        frame = FrameState(
            position = WorkspacePosition(12.0, 24.0),
            size = SheetFrameSize(480.0, 320.0),
            visualScale = 1.25,
            zIndex = 2,
        ),
        presentation = SheetPresentation(
            columnWidths = mapOf(
                EXTRACTION_MOVING.value to 96.0,
                EXTRACTION_STAYING.value to 80.0,
                EXTRACTION_REMAINING.value to 72.0,
            ),
            formatOverrides = SheetFormatOverrides(
                columns = mapOf(EXTRACTION_MOVING.value to CellFormat(numberFormat = NumberFormat("number", 2))),
                cells = mapOf(
                    "${EXTRACTION_ROW_ONE.value}\u0000${EXTRACTION_MOVING.value}" to CellFormat(fontWeight = "bold"),
                    "${EXTRACTION_ROW_ONE.value}\u0000${EXTRACTION_STAYING.value}" to CellFormat(textColor = "#123456"),
                ),
            ),
        ),
        content = TabularContent(
            rows = listOf(EXTRACTION_ROW_ONE, EXTRACTION_ROW_TWO),
            columns = listOf(EXTRACTION_STAYING, EXTRACTION_MOVING, EXTRACTION_REMAINING),
            cellContents = mapOf(
                CellCoordinate(EXTRACTION_ROW_ONE, EXTRACTION_STAYING) to "stay-1",
                CellCoordinate(EXTRACTION_ROW_ONE, EXTRACTION_MOVING) to "moved-1",
                CellCoordinate(EXTRACTION_ROW_ONE, EXTRACTION_REMAINING) to "right-1",
                CellCoordinate(EXTRACTION_ROW_TWO, EXTRACTION_STAYING) to "stay-2",
                CellCoordinate(EXTRACTION_ROW_TWO, EXTRACTION_MOVING) to "moved-2",
                CellCoordinate(EXTRACTION_ROW_TWO, EXTRACTION_REMAINING) to "right-2",
            ),
        ),
        columnNames = mapOf(EXTRACTION_MOVING.value to "Revenue", EXTRACTION_STAYING.value to "Left"),
    )
    val other = SheetDocument(
        id = SheetId(EXTRACTION_OTHER),
        name = "Other",
        frame = FrameState(position = WorkspacePosition(-64.0, 0.0), zIndex = 1),
        content = TabularContent(
            rows = listOf(EXTRACTION_ROW_ONE),
            columns = listOf(EXTRACTION_OTHER_COLUMN),
            cellContents = mapOf(
                CellCoordinate(EXTRACTION_ROW_ONE, EXTRACTION_OTHER_COLUMN) to
                    "=@${EXTRACTION_SOURCE}!${EXTRACTION_MOVING.value}[${EXTRACTION_ROW_ONE.value}]",
            ),
        ),
    )
    return emptyWorkbookState().addSheet(other).addSheet(source)
}

internal fun extractedFrom(workbook: WorkbookState): WorkbookState {
    val source = workbook.documents.getValue(SheetId(EXTRACTION_SOURCE))
    val other = workbook.documents.getValue(SheetId(EXTRACTION_OTHER))
    val target = SheetDocument(
        id = SheetId(EXTRACTION_TARGET),
        name = "Extracted",
        frame = FrameState(
            position = WorkspacePosition(36.0, 18.0),
            size = SheetFrameSize(160.0, 320.0),
            visualScale = 1.25,
            zIndex = 3,
        ),
        presentation = SheetPresentation(
            columnWidths = mapOf(EXTRACTION_MOVING.value to 96.0),
            formatOverrides = SheetFormatOverrides(
                columns = mapOf(EXTRACTION_MOVING.value to CellFormat(numberFormat = NumberFormat("number", 2))),
                cells = mapOf(
                    "${EXTRACTION_ROW_ONE.value}\u0000${EXTRACTION_MOVING.value}" to CellFormat(fontWeight = "bold"),
                ),
            ),
        ),
        content = TabularContent(
            rows = listOf(EXTRACTION_ROW_ONE, EXTRACTION_ROW_TWO),
            columns = listOf(EXTRACTION_MOVING),
            cellContents = mapOf(
                CellCoordinate(EXTRACTION_ROW_ONE, EXTRACTION_MOVING) to "moved-1",
                CellCoordinate(EXTRACTION_ROW_TWO, EXTRACTION_MOVING) to "moved-2",
            ),
        ),
        columnNames = mapOf(EXTRACTION_MOVING.value to "Revenue"),
    )
    val survivingSource = source.copy(
        content = TabularContent(
            rows = source.tabularContent.rows,
            columns = listOf(EXTRACTION_STAYING, EXTRACTION_REMAINING),
            cellContents = source.tabularContent.cellContents.filterKeys { it.columnId != EXTRACTION_MOVING },
        ),
        columnNames = source.columnNames - EXTRACTION_MOVING.value,
        presentation = SheetPresentation(
            columnWidths = source.presentation.columnWidths - EXTRACTION_MOVING.value,
            formatOverrides = SheetFormatOverrides(
                columns = source.presentation.formatOverrides.columns - EXTRACTION_MOVING.value,
                cells = source.presentation.formatOverrides.cells.filterKeys { key ->
                    key.substringAfter('\u0000') != EXTRACTION_MOVING.value
                },
            ),
        ),
    )
    val rewrittenOther = other.copy(
        content = TabularContent(
            rows = other.tabularContent.rows,
            columns = other.tabularContent.columns,
            cellContents = other.tabularContent.cellContents + (
                CellCoordinate(EXTRACTION_ROW_ONE, EXTRACTION_OTHER_COLUMN) to
                    "=@${EXTRACTION_TARGET}!${EXTRACTION_MOVING.value}[${EXTRACTION_ROW_ONE.value}]"
                ),
        ),
    )
    return workbook
        .replaceSheet(survivingSource)
        .addSheet(target)
        .replaceSheet(rewrittenOther)
}

internal fun withUniformRevision(workbook: WorkbookState, revision: Long): WorkbookState = workbook.copy(
    manifest = workbook.manifest.copy(revision = revision),
    documents = workbook.documents.mapValues { (_, sheet) -> sheet.copy(revision = revision) },
)

internal fun semanticSnapshot(workbook: WorkbookState): WorkbookState = workbook.copy(
    manifest = workbook.manifest.copy(revision = 0),
    documents = workbook.documents.mapValues { (_, sheet) -> sheet.copy(revision = 0) },
)
