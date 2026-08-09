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

data class SheetZOrderWrite(
    val expectedRevision: ExpectedSheetRevision,
    val zIndex: Int,
)

interface WorkbookStore {
    fun loadManifest(): WorkbookManifest

    fun loadSheet(sheetId: SheetId): SheetDocument?

    fun loadWorkbookBundle(): WorkbookState

    fun saveWorkbook(workbook: WorkbookState)

    fun writeCells(
        expectedRevision: ExpectedSheetRevision,
        writes: List<CellWrite>,
    ): SheetDocument

    fun updateSheetZOrder(writes: List<SheetZOrderWrite>): List<SheetDocument>

    fun updateWorkbook(
        expectedRevision: ExpectedSheetRevision? = null,
        transform: (WorkbookState) -> WorkbookState,
    ): WorkbookState
}
