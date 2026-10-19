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

    @Test
    fun `membership snapshots require the helper derived manifest revision in SQLite and memory`() {
        listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore()).forEach { store ->
            try {
                val first = testDocument(TEST_SHEET_1, "Inputs")
                val second = testDocument(TEST_SHEET_2, "Outputs")
                store.saveWorkbook(testWorkbookOf(first, second))
                val before = store.loadWorkbookBundle()

                listOf(99L, before.manifest.revision).forEach { forgedRevision ->
                    val forgedDelete = before.removeSheet(second.id).copy(
                        manifest = before.manifest.copy(
                            revision = forgedRevision,
                            sheetIds = listOf(first.id),
                        ),
                    )
                    assertFailsWith<WorkbookApplicationException> {
                        store.saveWorkbook(
                            forgedDelete,
                            expectedManifestRevision = before.manifest.revision,
                            expectedSheetRevisions = listOf(ExpectedSheetRevision(second.id.value, second.revision)),
                        )
                    }
                    assertEquals(before, store.loadWorkbookBundle())
                }

                store.saveWorkbook(
                    before.removeSheet(second.id),
                    expectedManifestRevision = before.manifest.revision,
                    expectedSheetRevisions = listOf(ExpectedSheetRevision(second.id.value, second.revision)),
                )
                val afterDelete = store.loadWorkbookBundle()
                assertEquals(before.manifest.revision + 1, afterDelete.manifest.revision)

                val restored = afterDelete.addSheet(second)
                listOf(99L, afterDelete.manifest.revision).forEach { forgedRevision ->
                    assertFailsWith<WorkbookApplicationException> {
                        store.updateWorkbook(expectedManifestRevision = afterDelete.manifest.revision) {
                            restored.copy(manifest = restored.manifest.copy(revision = forgedRevision))
                        }
                    }
                    assertEquals(afterDelete, store.loadWorkbookBundle())
                }

                val restoredByUpdate = store.updateWorkbook(expectedManifestRevision = afterDelete.manifest.revision) {
                    restored
                }
                assertEquals(afterDelete.manifest.revision + 1, restoredByUpdate.manifest.revision)

                val reordered = restoredByUpdate.copy(
                    manifest = restoredByUpdate.manifest.copy(
                        revision = restoredByUpdate.manifest.revision + 1,
                        sheetIds = restoredByUpdate.manifest.sheetIds.reversed(),
                    ),
                )
                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook(expectedManifestRevision = restoredByUpdate.manifest.revision) {
                        reordered.copy(manifest = reordered.manifest.copy(revision = 99))
                    }
                }
                assertEquals(restoredByUpdate, store.loadWorkbookBundle())
                store.updateWorkbook(expectedManifestRevision = restoredByUpdate.manifest.revision) { reordered }
                assertEquals(reordered, store.loadWorkbookBundle())
            } finally {
                (store as? AutoCloseable)?.close()
            }
        }
    }

    @Test
    fun `bound live deletion uses its singleton guard in SQLite and memory`() {
        listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore()).forEach { store ->
            try {
                val initial = boundWorkbook()
                val model = initial.dataModels.values.single()
                val second = testDocument(TEST_SHEET_2, "Other", tabular = TabularContent(rowCount = 2, columnCount = 2))
                val boundSecond = second.copy(
                    dataModelId = model.id,
                    content = TabularContent(
                        second.tabularContent.rows,
                        second.tabularContent.columns,
                        second.tabularContent.rows.associate { row ->
                            CellCoordinate(row, second.tabularContent.columns[1]) to
                                "=@${second.tabularContent.columns[0].value}[${row.value}]*2"
                        },
                    ),
                )
                store.saveWorkbook(initial.addSheet(boundSecond))
                val before = store.loadWorkbookBundle()
                val removed = before.sheetsInOrder.first()

                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook { it.removeSheet(removed.id) }
                }
                assertEquals(before, store.loadWorkbookBundle())
                assertFailsWith<SheetRevisionConflict> {
                    store.updateWorkbook(ExpectedSheetRevision(removed.id.value, removed.revision + 1)) {
                        it.removeSheet(removed.id)
                    }
                }
                assertEquals(before, store.loadWorkbookBundle())

                DefaultWorkbookApplication(store).deleteSheet(removed.id.value, removed.revision)
                val after = store.loadWorkbookBundle()
                assertEquals(before.manifest.revision + 1, after.manifest.revision)
                assertEquals(boundSecond.dataModelId, after.findSheet(boundSecond.id)?.dataModelId)
                assertEquals(after, store.loadWorkbookBundle())
            } finally {
                (store as? AutoCloseable)?.close()
            }
        }
    }
}
