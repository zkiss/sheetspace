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
    fun loadWorkbook(): Workbook

    fun saveWorkbook(workbook: Workbook)

    fun updateWorkbook(
        expectedRevision: ExpectedSheetRevision? = null,
        transform: (Workbook) -> Workbook,
    ): Workbook
}
