package com.sheetspace

data class ExpectedSheetRevision(
    val sheetId: String,
    val revision: Long,
)

class SheetRevisionConflict(
    val sheetId: String,
    val expectedRevision: Long,
    val actualRevision: Long,
) : RuntimeException("Sheet $sheetId revision conflict: expected $expectedRevision, actual $actualRevision")

data class CellWrite(
    val coordinate: CellCoordinate,
    val content: String,
)

interface WorkbookStore {
    fun loadManifest(): WorkbookManifest

    fun loadSheet(sheetId: SheetId): SheetDocument?

    fun loadWorkbook(): WorkbookState

    fun saveWorkbook(workbook: WorkbookState)

    fun writeCells(
        expectedRevision: ExpectedSheetRevision,
        writes: List<CellWrite>,
    ): SheetDocument

    fun updateWorkbook(
        expectedRevision: ExpectedSheetRevision? = null,
        transform: (WorkbookState) -> WorkbookState,
    ): WorkbookState
}
