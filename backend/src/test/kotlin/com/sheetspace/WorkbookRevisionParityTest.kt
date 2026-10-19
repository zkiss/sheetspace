package com.sheetspace

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookRevisionParityTest {
    @Test
    fun `SQLite and memory initialize new aggregate sheets instead of publishing caller revisions`() {
        val initialWorkbook = testWorkbookOf(testDocument(TEST_SHEET_1, "Initial"))
        val snapshotAdded = testDocument(TEST_SHEET_2, "Snapshot add").copy(revision = 99)
        val liveAdded = testDocument("00000000-0000-0000-0000-000000000003", "Live add").copy(revision = 99)
        val results = parityStores().map { store ->
            store.useForRevisionParity {
                store.saveWorkbook(initialWorkbook)
                val initial = store.loadWorkbookBundle()

                store.saveWorkbook(initial.addSheet(snapshotAdded), initial.manifest.revision)
                val afterSnapshotAdd = store.loadWorkbookBundle()
                assertEquals(0, afterSnapshotAdd.documents.getValue(SheetId(TEST_SHEET_2)).revision)

                store.updateWorkbook { current -> current.addSheet(liveAdded) }
                store.loadWorkbookBundle().also { afterLiveAdd ->
                    assertEquals(0, afterLiveAdd.documents.getValue(liveAdded.id).revision)
                }
            }
        }

        assertEquals(results[0], results[1])
    }

    @Test
    fun `SQLite and memory publish matching aggregate revisions`() {
        val initial = testWorkbookOf(
            testDocument(TEST_SHEET_1, "Inputs"),
            testDocument(TEST_SHEET_2, "Outputs"),
            testDocument("00000000-0000-0000-0000-000000000003", "Notes"),
            testDocument("00000000-0000-0000-0000-000000000004", "Archive"),
        )
        val results = listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore()).map { store ->
            store.useForRevisionParity {
                store.saveWorkbook(initial)
                store.saveWorkbook(boundRevisionAggregate(initial), 0, initial.revisionGuards().take(2))
                val bound = store.loadWorkbookBundle()
                assertEquals(listOf(1L, 1L, 0L, 0L), bound.sheetsInOrder.map(SheetDocument::revision))
                assertEquals(1, bound.manifest.revision)

                val boundGuards = bound.boundRevisionGuards()
                val renamed = bound.copy(dataModels = bound.dataModels.mapValues { (_, model) -> model.copy(name = "Renamed") })
                store.updateWorkbook(expectedManifestRevision = 1, expectedSheetRevisions = boundGuards) { renamed }
                val modelOnly = store.loadWorkbookBundle()
                assertEquals(listOf(1L, 1L, 0L, 0L), modelOnly.sheetsInOrder.map(SheetDocument::revision))
                assertEquals(2, modelOnly.manifest.revision)

                val staleSecond = modelOnly.boundRevisionGuards().map {
                    if (it.sheetId == TEST_SHEET_2) it.copy(revision = 0) else it
                }
                assertFailsWith<SheetRevisionConflict> {
                    store.updateWorkbook(expectedManifestRevision = 2, expectedSheetRevisions = staleSecond) { current ->
                        current.copy(dataModels = current.dataModels.mapValues { (_, model) -> model.copy(name = "Stale") })
                    }
                }
                assertEquals(modelOnly, store.loadWorkbookBundle())

                store.updateWorkbook(expectedSheetRevisions = modelOnly.unboundRevisionGuards()) { current ->
                    current.replaceSheet(current.documents.getValue(SheetId("00000000-0000-0000-0000-000000000003")).rename("Edited notes"))
                        .replaceSheet(current.documents.getValue(SheetId("00000000-0000-0000-0000-000000000004")).rename("Edited archive"))
                }
                store.loadWorkbookBundle().also { ordinaryUpdate ->
                    assertEquals(listOf(1L, 1L, 1L, 1L), ordinaryUpdate.sheetsInOrder.map(SheetDocument::revision))
                    assertEquals(2, ordinaryUpdate.manifest.revision)
                }
            }
        }

        assertEquals(results[0], results[1])
    }

    @Test
    fun `SQLite and memory keep no-op snapshots tampering and dedicated writes in parity`() {
        val initial = testWorkbookOf(
            testDocument(TEST_SHEET_1, "Inputs", FrameState(zIndex = 1)),
            testDocument(TEST_SHEET_2, "Outputs", FrameState(zIndex = 2)),
        )

        val results = parityStores().map { store ->
            store.useForRevisionParity {
                store.saveWorkbook(initial)
                val saved = store.loadWorkbookBundle()

                store.saveWorkbook(saved)
                assertEquals(saved, store.loadWorkbookBundle())

                val forged = saved.copy(documents = saved.documents.mapValues { (_, sheet) -> sheet.copy(revision = 99) })
                assertFailsWith<WorkbookApplicationException> {
                    store.saveWorkbook(forged, saved.manifest.revision, saved.revisionGuards())
                }
                assertEquals(saved, store.loadWorkbookBundle())

                val writes = listOf(
                    saved.documents.getValue(SheetId(TEST_SHEET_1)).cellWrite("A1", "changed"),
                    saved.documents.getValue(SheetId(TEST_SHEET_2)).cellWrite("A1", ""),
                )
                store.writeCells(saved.revisionGuards(), writes)
                val afterCells = store.loadWorkbookBundle()
                assertEquals(listOf(1L, 0L), afterCells.sheetsInOrder.map(SheetDocument::revision))

                store.writePresentation(
                    ExpectedSheetRevision(TEST_SHEET_1, 1),
                    listOf(AxisSizeWrite("column", afterCells.sheetsInOrder.first().tabularContent.columns.first().value, 120.0)),
                )
                store.updateSheetZOrder(
                    listOf(
                        SheetZOrderWrite(ExpectedSheetRevision(TEST_SHEET_1, 2), 2),
                        SheetZOrderWrite(ExpectedSheetRevision(TEST_SHEET_2, 0), 1),
                    ),
                )
                val beforeStale = store.loadWorkbookBundle()
                assertEquals(listOf(3L, 1L), beforeStale.sheetsInOrder.map(SheetDocument::revision))
                assertFailsWith<SheetRevisionConflict> {
                    store.writeCells(
                        listOf(ExpectedSheetRevision(TEST_SHEET_1, 3), ExpectedSheetRevision(TEST_SHEET_2, 0)),
                        listOf(
                            beforeStale.documents.getValue(SheetId(TEST_SHEET_1)).cellWrite("A1", "rolled back"),
                            beforeStale.documents.getValue(SheetId(TEST_SHEET_2)).cellWrite("A1", "also rolled back"),
                        ),
                    )
                }
                assertEquals(beforeStale, store.loadWorkbookBundle())
                beforeStale
            }
        }

        assertEquals(results[0], results[1])
    }

    @Test
    fun `file backed SQLite reopens accepted and rejected aggregate publications intact`() {
        val database = Files.createTempFile("sheetspace-revision-parity", ".db")
        try {
            val initial = testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs"), testDocument(TEST_SHEET_2, "Outputs"))
            val persisted = SqliteWorkbookStore(database).use { store ->
                store.saveWorkbook(initial)
                store.saveWorkbook(boundRevisionAggregate(initial), 0, initial.revisionGuards())
                store.loadWorkbookBundle()
            }

            SqliteWorkbookStore(database).use { reopened ->
                assertEquals(persisted, reopened.loadWorkbookBundle())
                val staleGuards = persisted.boundRevisionGuards().map { it.copy(revision = it.revision - 1) }
                assertFailsWith<SheetRevisionConflict> {
                    reopened.updateWorkbook(expectedManifestRevision = 1, expectedSheetRevisions = staleGuards) { current ->
                        current.copy(dataModels = current.dataModels.mapValues { (_, model) -> model.copy(name = "Rejected") })
                    }
                }
                assertEquals(persisted, reopened.loadWorkbookBundle())
            }
        } finally {
            Files.deleteIfExists(database)
            Files.deleteIfExists(database.resolveSibling("${database.fileName}-wal"))
            Files.deleteIfExists(database.resolveSibling("${database.fileName}-shm"))
        }
    }

    @Test
    fun `SQLite and memory roll back mixed manual and calculated cell writes identically`() {
        val workbook = calculatedCellWorkbook()
        val results = parityStores().map { store ->
            store.useForRevisionParity {
                store.saveWorkbook(workbook)
                val before = store.loadWorkbookBundle()
                val sheet = before.sheetsInOrder.single()
                assertFailsWith<WorkbookApplicationException> {
                    store.writeCells(
                        listOf(ExpectedSheetRevision(sheet.id.value, sheet.revision)),
                        listOf(sheet.cellWrite("A1", "3"), sheet.cellWrite("B1", "=6")),
                    )
                }
                assertEquals(before, store.loadWorkbookBundle())
                before
            }
        }

        assertEquals(results[0], results[1])
    }
}

private fun boundRevisionAggregate(workbook: WorkbookState): WorkbookState {
    val model = DataModel(
        "00000000-0000-0000-0000-000000000401",
        "Metrics",
        listOf(ManualDataModelProperty("00000000-0000-0000-0000-000000000402", "Amount", DataModelPropertyType.FLOAT)),
    )
    return workbook.copy(dataModels = mapOf(model.id to model)).let { aggregate ->
        aggregate.sheetsInOrder.take(2).fold(aggregate) { updated, sheet ->
            updated.replaceSheet(sheet.copy(
                dataModelId = model.id,
                content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns.take(1), emptyMap()),
            ))
        }
    }
}

private fun WorkbookState.revisionGuards(): List<ExpectedSheetRevision> =
    sheetsInOrder.map { ExpectedSheetRevision(it.id.value, it.revision) }

private fun WorkbookState.boundRevisionGuards(): List<ExpectedSheetRevision> =
    sheetsInOrder.filter { it.dataModelId != null }.map { ExpectedSheetRevision(it.id.value, it.revision) }

private fun WorkbookState.unboundRevisionGuards(): List<ExpectedSheetRevision> =
    sheetsInOrder.filter { it.dataModelId == null }.map { ExpectedSheetRevision(it.id.value, it.revision) }

private fun parityStores(): List<WorkbookStore> = listOf(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore())

private fun calculatedCellWorkbook(): WorkbookState {
    val content = TabularContent(columnCount = 2)
    val modelId = "00000000-0000-0000-0000-000000000501"
    val sheet = testDocument(TEST_SHEET_1, "Calculated", tabular = TabularContent(
        content.rows,
        content.columns,
        content.rows.associate { row ->
            CellCoordinate(row, content.columns[1]) to "=@${content.columns[0].value}[${row.value}]*2"
        },
    )).copy(dataModelId = modelId)
    val model = DataModel(
        modelId,
        "Calculated",
        listOf(
            ManualDataModelProperty("00000000-0000-0000-0000-000000000502", "Amount", DataModelPropertyType.STRING),
            CalculatedDataModelProperty("00000000-0000-0000-0000-000000000503", "Double", "=@A[1]*2", DataModelPropertyType.FLOAT),
        ),
    )
    return testWorkbookOf(sheet).copy(dataModels = mapOf(model.id to model))
}

private inline fun <T> WorkbookStore.useForRevisionParity(block: () -> T): T =
    try {
        block()
    } finally {
        (this as? AutoCloseable)?.close()
    }
