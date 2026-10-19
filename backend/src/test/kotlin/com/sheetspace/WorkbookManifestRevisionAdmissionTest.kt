package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookManifestRevisionAdmissionTest {
    @Test
    fun `ordinary snapshots cannot forge manifest revisions in SQLite or memory`() {
        listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore()).forEach { store ->
            try {
                store.saveWorkbook(testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs")))
                val before = store.loadWorkbookBundle()
                val sheet = before.sheetsInOrder.single()

                listOf(
                    before.copy(manifest = before.manifest.copy(revision = before.manifest.revision + 1)),
                    before.copy(manifest = before.manifest.copy(revision = before.manifest.revision - 1)),
                ).forEach { forged ->
                    assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(forged) }
                    assertEquals(before, store.loadWorkbookBundle())
                }

                assertFailsWith<WorkbookApplicationException> {
                    store.saveWorkbook(
                        before.replaceSheet(sheet.rename("Forged save")).copy(
                            manifest = before.manifest.copy(revision = before.manifest.revision + 1),
                        ),
                        expectedSheetRevisions = before.sheetsInOrder.map { current ->
                            ExpectedSheetRevision(current.id.value, current.revision)
                        },
                    )
                }
                assertEquals(before, store.loadWorkbookBundle())

                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook { current ->
                        current.copy(manifest = current.manifest.copy(revision = current.manifest.revision + 1))
                    }
                }
                assertEquals(before, store.loadWorkbookBundle())

                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook(ExpectedSheetRevision(sheet.id.value, sheet.revision)) { current ->
                        current.replaceSheet(sheet.rename("Forged update")).copy(
                            manifest = current.manifest.copy(revision = current.manifest.revision - 1),
                        )
                    }
                }
                assertEquals(before, store.loadWorkbookBundle())
            } finally {
                (store as? AutoCloseable)?.close()
            }
        }
    }
}
