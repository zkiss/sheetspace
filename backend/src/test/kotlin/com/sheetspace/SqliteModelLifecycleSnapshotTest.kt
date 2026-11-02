package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class SqliteModelLifecycleSnapshotTest {
    @Test
    fun `forward snapshot commits target creation source structure and unrelated rewrite in one durable store`() {
        val database = tempSqlitePath()
        val initial = extractionWorkbook()
        val after = extractedFrom(initial)
        try {
            val saved = SqliteWorkbookStore(database).use { store ->
                store.saveWorkbook(initial)
                DefaultWorkbookApplication(store).saveModelLifecycle(initial, after)
            }
            SqliteWorkbookStore(database).use { store ->
                assertEquals(semanticSnapshot(after), store.loadWorkbookBundle().let(::semanticSnapshot))
                val source = store.loadSheet(SheetId(EXTRACTION_SOURCE))!!
                val target = store.loadSheet(SheetId(EXTRACTION_TARGET))!!
                val other = store.loadSheet(SheetId(EXTRACTION_OTHER))!!

                assertEquals(listOf(EXTRACTION_STAYING, EXTRACTION_REMAINING), source.tabularContent.columns)
                assertEquals(mapOf("A1" to "stay-1", "A2" to "stay-2", "B1" to "right-1", "B2" to "right-2"), source.tabularContent.cells)
                assertEquals(mapOf(EXTRACTION_STAYING.value to "Left"), source.columnNames)
                assertEquals(listOf(EXTRACTION_MOVING), target.tabularContent.columns)
                assertEquals(mapOf("A1" to "moved-1", "A2" to "moved-2"), target.tabularContent.cells)
                assertEquals(mapOf(EXTRACTION_MOVING.value to "Revenue"), target.columnNames)
                assertEquals(
                    "=@${EXTRACTION_TARGET}!${EXTRACTION_MOVING.value}[${EXTRACTION_ROW_ONE.value}]",
                    other.tabularContent.cells["A1"],
                )
                assertEquals(WorkspacePosition(36.0, 18.0), target.frame.position)
                assertEquals(3, target.frame.zIndex)
                assertEquals(1.25, target.frame.visualScale)
                assertEquals(96.0, target.presentation.columnWidths[EXTRACTION_MOVING.value])
                assertEquals(
                    CellFormat(fontWeight = "bold"),
                    target.presentation.formatOverrides.cells["${EXTRACTION_ROW_ONE.value}\u0000${EXTRACTION_MOVING.value}"],
                )
                assertEquals(
                    CellFormat(numberFormat = NumberFormat("number", 2)),
                    target.presentation.formatOverrides.columns[EXTRACTION_MOVING.value],
                )
                assertEquals(
                    CellFormat(textColor = "#123456"),
                    source.presentation.formatOverrides.cells["${EXTRACTION_ROW_ONE.value}\u0000${EXTRACTION_STAYING.value}"],
                )
                assertEquals(saved, store.loadWorkbookBundle())
            }
        } finally {
            deleteSqliteArtifacts(database)
        }
    }

    @Test
    fun `changed survivors advance document revisions while untouched sheets and the manifest split those counts`() =
        withSqliteStore { store ->
            val application = DefaultWorkbookApplication(store)
            val idle = SheetDocument(SheetId("40000000-0000-0000-0000-000000000004"), name = "Idle")
            val initial = extractionWorkbook().addSheet(idle)
            store.saveWorkbook(initial)

            val saved = application.saveModelLifecycle(initial, extractedFrom(initial))

            assertEquals(initial.manifest.revision + 1, saved.manifest.revision)
            assertEquals(0, saved.documents.getValue(idle.id).revision)
            assertEquals(1, saved.documents.getValue(SheetId(EXTRACTION_SOURCE)).revision)
            assertEquals(1, saved.documents.getValue(SheetId(EXTRACTION_OTHER)).revision)
            assertEquals(0, saved.documents.getValue(SheetId(EXTRACTION_TARGET)).revision)
        }

    @Test
    fun `inverse snapshot removes the target and restores source structure and the original reference`() =
        withSqliteStore { store ->
            val application = DefaultWorkbookApplication(store)
            val initial = extractionWorkbook()
            store.saveWorkbook(initial)
            val extracted = application.saveModelLifecycle(initial, extractedFrom(initial))

            val undone = application.saveModelLifecycle(extracted, initial)

            assertEquals(semanticSnapshot(initial), undone.let(::semanticSnapshot))
            assertEquals(extracted.manifest.revision + 1, undone.manifest.revision)
            assertNull(store.loadSheet(SheetId(EXTRACTION_TARGET)))
            assertEquals(semanticSnapshot(initial), store.loadWorkbookBundle().let(::semanticSnapshot))
            assertEquals(
                initial.manifest.sheetIds.map { it.value },
                undone.manifest.sheetIds.map { it.value },
            )
        }

    @Test
    fun `redo recreation resets a historical identity to revision zero and accepts ordinary writes`() =
        withSqliteStore { store ->
            val application = DefaultWorkbookApplication(store)
            val initial = extractionWorkbook()
            store.saveWorkbook(initial)
            val extracted = application.saveModelLifecycle(initial, extractedFrom(initial))
            val undone = application.saveModelLifecycle(extracted, initial)
            val historical = withUniformRevision(extractedFrom(initial), 99)

            val redone = application.saveModelLifecycle(undone, historical)

            assertEquals(0, redone.documents.getValue(SheetId(EXTRACTION_TARGET)).revision)
            assertEquals(undone.manifest.revision + 1, redone.manifest.revision)
            assertEquals(extracted.let(::semanticSnapshot), redone.let(::semanticSnapshot))

            val written = application.writeCells(
                CellPatchCommand(
                    listOf(ExpectedSheetRevision(EXTRACTION_TARGET, 0)),
                    listOf(
                        SheetCellWrite(
                            EXTRACTION_TARGET,
                            EXTRACTION_ROW_ONE.value,
                            EXTRACTION_MOVING.value,
                            "rewritten",
                        ),
                    ),
                ),
            ).single()

            assertEquals(1, written.revision)
            assertEquals("rewritten", store.loadSheet(SheetId(EXTRACTION_TARGET))!!.tabularContent.cells["A1"])
        }

    @Test
    fun `exact retry of a committed snapshot succeeds without duplicating the target`() =
        withSqliteStore { store ->
            val application = DefaultWorkbookApplication(store)
            val initial = extractionWorkbook()
            store.saveWorkbook(initial)
            val after = extractedFrom(initial)

            val saved = application.saveModelLifecycle(initial, after)
            val replayed = application.saveModelLifecycle(initial, after)
            val semanticReplay = application.saveModelLifecycle(saved, after)

            assertEquals(saved, replayed)
            assertEquals(saved, semanticReplay)
            assertEquals(listOf(EXTRACTION_TARGET), store.loadManifest().sheetIds.map { it.value }.filter { it == EXTRACTION_TARGET })
        }

    @Test
    fun `a conflicted retry never overwrites a concurrent edit on a surviving sheet`() =
        withSqliteStore { store ->
            val application = DefaultWorkbookApplication(store)
            val initial = extractionWorkbook()
            store.saveWorkbook(initial)
            val after = extractedFrom(initial)
            val saved = application.saveModelLifecycle(initial, after)
            val source = saved.documents.getValue(SheetId(EXTRACTION_SOURCE))
            application.writeCells(
                CellPatchCommand(
                    listOf(ExpectedSheetRevision(EXTRACTION_SOURCE, source.revision)),
                    listOf(
                        SheetCellWrite(
                            EXTRACTION_SOURCE,
                            EXTRACTION_ROW_ONE.value,
                            EXTRACTION_STAYING.value,
                            "concurrent",
                        ),
                    ),
                ),
            )

            assertEquals(
                WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT,
                assertFailsWith<WorkbookApplicationException> { application.saveModelLifecycle(initial, after) }.error,
            )
            assertEquals("concurrent", store.loadSheet(SheetId(EXTRACTION_SOURCE))!!.tabularContent.cells["A1"])
            assertEquals(listOf(EXTRACTION_STAYING, EXTRACTION_REMAINING), store.loadSheet(SheetId(EXTRACTION_SOURCE))!!.tabularContent.columns)
            assertEquals("moved-1", store.loadSheet(SheetId(EXTRACTION_TARGET))!!.tabularContent.cells["A1"])
        }

    @Test
    fun `invalid stale and protected rejections leave every stored sheet unchanged`() =
        withSqliteStore { store ->
            val application = DefaultWorkbookApplication(store)
            val initial = extractionWorkbook()
            store.saveWorkbook(initial)
            val extracted = extractedFrom(initial)
            val duplicateName = extracted.replaceSheet(
                extracted.documents.getValue(SheetId(EXTRACTION_TARGET)).rename("Source"),
            )
            val invalidFrame = extracted.replaceSheet(
                extracted.documents.getValue(SheetId(EXTRACTION_TARGET)).updateFrame { it.update(zIndex = 0) },
            )
            listOf(duplicateName, invalidFrame).forEach { invalid ->
                assertEquals(
                    WorkbookApplicationError.INVALID_MODEL_LIFECYCLE,
                    assertFailsWith<WorkbookApplicationException> { application.saveModelLifecycle(initial, invalid) }.error,
                )
                assertEquals(initial, store.loadWorkbookBundle())
            }

            val concurrent = store.updateWorkbook { current ->
                current.replaceSheet(
                    current.documents.getValue(SheetId(EXTRACTION_SOURCE)).rename("Concurrent"),
                )
            }
            assertEquals(
                WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT,
                assertFailsWith<WorkbookApplicationException> { application.saveModelLifecycle(initial, extracted) }.error,
            )
            assertEquals(concurrent, store.loadWorkbookBundle())
        }

    @Test
    fun `a snapshot may free a deleted name and reuse it on a surviving sheet`() =
        withSqliteStore { store ->
            val application = DefaultWorkbookApplication(store)
            val initial = extractionWorkbook()
            store.saveWorkbook(initial)
            val extracted = extractedFrom(initial)
            val after = extracted
                .replaceSheet(extracted.documents.getValue(SheetId(EXTRACTION_OTHER)).rename("Source"))
                .removeSheet(SheetId(EXTRACTION_SOURCE))

            val saved = application.saveModelLifecycle(initial, after)

            assertNull(store.loadSheet(SheetId(EXTRACTION_SOURCE)))
            assertEquals("Source", saved.documents.getValue(SheetId(EXTRACTION_OTHER)).name)
            assertEquals("Source", store.loadSheet(SheetId(EXTRACTION_OTHER))!!.name)
            assertEquals(setOf(EXTRACTION_OTHER, EXTRACTION_TARGET), saved.manifest.sheetIds.map { it.value }.toSet())
        }

    @Test
    fun `ordinary undo may delete a model bound target while calculated survivors stay protected`() =
        withSqliteStore { store ->
            val application = DefaultWorkbookApplication(store)
            val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
            store.saveWorkbook(bound)
            val target = bound.sheetsInOrder.first()
            val survivor = bound.sheetsInOrder.last()

            val removed = application.saveModelLifecycle(bound, bound.removeSheet(target.id))

            assertNull(store.loadSheet(target.id))
            assertEquals(survivor.id, removed.sheetsInOrder.single().id)
            assertEquals(LIFECYCLE_MODEL, removed.sheetsInOrder.single().modelId)

            val sheet = removed.sheetsInOrder.single()
            val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
            val coordinate = CellCoordinate(sheet.tabularContent.rows.first(), output)
            val tampered = removed.replaceSheet(
                sheet.copy(
                    content = sheet.tabularContent.updateCell(sheet.tabularContent.addressOf(coordinate)!!, "=stale"),
                ),
            )
            assertEquals(
                WorkbookApplicationError.CALCULATED_CELL_WRITE,
                assertFailsWith<WorkbookApplicationException> { application.saveModelLifecycle(removed, tampered) }.error,
            )
            assertEquals(removed, store.loadWorkbookBundle())
        }
}
