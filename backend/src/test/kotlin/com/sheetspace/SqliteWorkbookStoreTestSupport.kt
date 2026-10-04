package com.sheetspace

import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

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

internal inline fun <reified T : Throwable> assertRejectedWithoutPersisting(
    store: WorkbookStore,
    action: () -> Unit,
): T {
    val before = store.loadWorkbookBundle()
    val exception = assertFailsWith<T> { action() }
    assertEquals(before, store.loadWorkbookBundle())
    return exception
}
