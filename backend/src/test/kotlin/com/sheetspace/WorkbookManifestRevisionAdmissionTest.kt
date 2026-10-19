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

                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook(ExpectedSheetRevision(removed.id.value, removed.revision)) { current ->
                        current.removeSheet(removed.id).copy(
                            dataModels = current.dataModels + (model.id to model.copy(name = "Renamed")),
                        )
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

    @Test
    fun `bound snapshot deletion requires its deleted sheet guard in SQLite and memory`() {
        listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore()).forEach { store ->
            try {
                val initial = boundWorkbook()
                val model = initial.dataModels.values.single()
                val other = testDocument(TEST_SHEET_2, "Other", tabular = TabularContent(rowCount = 2, columnCount = 2))
                val boundOther = other.copy(
                    dataModelId = model.id,
                    content = TabularContent(
                        other.tabularContent.rows,
                        other.tabularContent.columns,
                        other.tabularContent.rows.associate { row ->
                            CellCoordinate(row, other.tabularContent.columns[1]) to
                                "=@${other.tabularContent.columns[0].value}[${row.value}]*2"
                        },
                    ),
                )
                store.saveWorkbook(initial.addSheet(boundOther))
                val before = store.loadWorkbookBundle()
                val deleted = before.sheetsInOrder.first()
                val survivor = before.sheetsInOrder.last()
                val candidate = before.removeSheet(deleted.id)

                listOf(
                    emptyList(),
                    listOf(ExpectedSheetRevision(deleted.id.value, deleted.revision + 1)),
                    listOf(ExpectedSheetRevision(deleted.id.value, deleted.revision), ExpectedSheetRevision(survivor.id.value, survivor.revision)),
                ).forEach { guards ->
                    assertFailsWith<RuntimeException> {
                        store.saveWorkbook(candidate, before.manifest.revision, guards)
                    }
                    assertEquals(before, store.loadWorkbookBundle())
                }

                store.saveWorkbook(
                    candidate,
                    before.manifest.revision,
                    listOf(ExpectedSheetRevision(deleted.id.value, deleted.revision)),
                )
                assertEquals(candidate, store.loadWorkbookBundle())
            } finally {
                (store as? AutoCloseable)?.close()
            }
        }
    }

    @Test
    fun `bound snapshot deletion through list update requires snapshot guards in SQLite and memory`() {
        listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore()).forEach { store ->
            try {
                val initial = boundWorkbook()
                store.saveWorkbook(initial)
                val before = store.loadWorkbookBundle()
                val deleted = before.sheetsInOrder.single()
                val candidate = before.removeSheet(deleted.id)
                val guard = ExpectedSheetRevision(deleted.id.value, deleted.revision)

                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook(expectedManifestRevision = before.manifest.revision) { candidate }
                }
                assertEquals(before, store.loadWorkbookBundle())
                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook(
                        expectedManifestRevision = before.manifest.revision - 1,
                        expectedSheetRevisions = listOf(guard),
                    ) { candidate }
                }
                assertEquals(before, store.loadWorkbookBundle())

                val updated = store.updateWorkbook(
                    expectedManifestRevision = before.manifest.revision,
                    expectedSheetRevisions = listOf(guard),
                ) { candidate }
                assertEquals(candidate, updated)
                assertEquals(candidate, store.loadWorkbookBundle())
            } finally {
                (store as? AutoCloseable)?.close()
            }
        }
    }

    @Test
    fun `singleton update cannot authorize unrelated sheet creation in SQLite or memory`() {
        listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore()).forEach { store ->
            try {
                val existing = testDocument(TEST_SHEET_1, "Inputs")
                store.saveWorkbook(testWorkbookOf(existing))
                val before = store.loadWorkbookBundle()

                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook(ExpectedSheetRevision(existing.id.value, existing.revision)) { current ->
                        current.addSheet(testDocument(TEST_SHEET_2, "Unrelated"))
                    }
                }

                assertEquals(before, store.loadWorkbookBundle())
            } finally {
                (store as? AutoCloseable)?.close()
            }
        }
    }

    @Test
    fun `live create admits only the exact application projection in SQLite and memory`() {
        listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore()).forEach { store ->
            try {
                val first = testDocument(TEST_SHEET_1, "Inputs")
                val second = testDocument(TEST_SHEET_2, "Outputs")
                store.saveWorkbook(testWorkbookOf(first, second))
                val before = store.loadWorkbookBundle()
                val added = testDocument("00000000-0000-0000-0000-000000000003", "New")
                val created = before.addSheet(added)

                listOf(
                    created.copy(manifest = created.manifest.copy(sheetIds = listOf(second.id, first.id, added.id))),
                    created.copy(manifest = created.manifest.copy(version = WORKBOOK_SCHEMA_VERSION + 1)),
                    created.copy(manifest = created.manifest.copy(revision = before.manifest.revision)),
                ).forEach { malformed ->
                    assertFailsWith<WorkbookApplicationException> {
                        store.updateWorkbook { malformed }
                    }
                    assertEquals(before, store.loadWorkbookBundle())
                }

                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook(expectedManifestRevision = before.manifest.revision + 1) { created }
                }
                assertEquals(before, store.loadWorkbookBundle())

                assertEquals(created, store.updateWorkbook(expectedManifestRevision = before.manifest.revision) { created })
            } finally {
                (store as? AutoCloseable)?.close()
            }
        }
    }
}
