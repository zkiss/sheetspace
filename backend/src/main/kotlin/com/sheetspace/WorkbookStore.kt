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

interface WorkbookStore {
    fun loadWorkbook(): WorkbookState

    fun saveWorkbook(workbook: WorkbookState)

    fun updateWorkbook(
        expectedRevision: ExpectedSheetRevision? = null,
        transform: (WorkbookState) -> WorkbookState,
    ): WorkbookState
}
