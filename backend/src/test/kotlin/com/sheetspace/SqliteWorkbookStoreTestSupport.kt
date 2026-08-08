package com.sheetspace

internal const val TEST_SHEET_1 = "00000000-0000-0000-0000-000000000001"
internal const val TEST_SHEET_2 = "00000000-0000-0000-0000-000000000002"

internal fun withSqliteStore(block: (SqliteWorkbookStore) -> Unit) {
    SqliteWorkbookStore.inMemory().use(block)
}

internal fun testDocument(
    id: String,
    name: String,
    frame: FrameState = FrameState(),
    tabular: TabularContent = TabularContent(),
): SheetDocument = SheetDocument(
    id = SheetId(id),
    name = name,
    frame = frame,
    content = tabular,
)

internal fun testWorkbookOf(vararg sheets: SheetDocument): WorkbookState = WorkbookState(
    manifest = WorkbookManifest(sheetIds = sheets.map { it.id }),
    documents = sheets.associateBy { it.id },
)
