package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookRevisionParityTest {
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

private inline fun <T> WorkbookStore.useForRevisionParity(block: () -> T): T =
    try {
        block()
    } finally {
        (this as? AutoCloseable)?.close()
    }
