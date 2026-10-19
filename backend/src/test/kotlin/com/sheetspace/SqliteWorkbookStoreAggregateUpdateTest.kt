package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class SqliteWorkbookStoreAggregateUpdateTest {
    @Test
    fun `aggregate updates persist additions removals and changed fields`() = withSqliteStore { store ->
        val first = testDocument(TEST_SHEET_1, "Inputs")
        val second = testDocument(TEST_SHEET_2, "Outputs")
        store.saveWorkbook(testWorkbookOf(first))
        val changed = first.rename("Renamed").updateFrame { it.update(position = WorkspacePosition(7.0, 8.0)) }.updateTabularContent { it.copy(rowCount = DEFAULT_ROW_COUNT - 1, columnCount = DEFAULT_COLUMN_COUNT + 1) }
        store.updateWorkbook { it.replaceSheet(changed).addSheet(second) }
        store.updateWorkbook { it.removeSheet(second.id) }
        val loaded = store.loadSheet(first.id)!!
        assertEquals("Renamed", loaded.name)
        assertEquals(WorkspacePosition(7.0, 8.0), loaded.frame.position)
        assertEquals(DEFAULT_ROW_COUNT - 1, loaded.tabularContent.rowCount)
        assertEquals(DEFAULT_COLUMN_COUNT + 1, loaded.tabularContent.columnCount)
        assertNull(store.loadSheet(second.id))
    }

    @Test
    fun `aggregate writes reject obsolete snapshots without overwriting newer cells`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val stale = store.loadWorkbookBundle()
        store.writeCells(listOf(ExpectedSheetRevision(TEST_SHEET_1, 0)), listOf(sheet.cellWrite("A1", "newer")))
        val before = store.loadWorkbookBundle()
        SqliteDatabase(store.jdbcUrl, null).use { database -> database.transaction { connection ->
            val writer = SqliteWorkbookWriter(connection, SqliteWorkbookReader(connection))
            val conflict = assertFailsWith<SheetRevisionConflict> {
                writer.persistChanges(stale, stale.replaceSheet(stale.findSheet(sheet.id)!!.rename("Renamed")))
            }
            assertEquals(TEST_SHEET_1, conflict.sheetId)
            assertEquals(0, conflict.expectedRevision)
            assertEquals(1, conflict.actualRevision)
        } }
        assertEquals(before, store.loadWorkbookBundle())
    }

    @Test
    fun `aggregate writes leave the full bundle unchanged for an absent revision target`() = withSqliteStore { store ->
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        store.saveWorkbook(testWorkbookOf(sheet))
        val before = store.loadWorkbookBundle()

        val updated = store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_2, 0)) { it }

        assertEquals(before, updated)
        assertEquals(before, store.loadWorkbookBundle())
    }

    @Test
    fun `aggregate model changes require the current manifest revision and reject invalid snapshots atomically`() = withSqliteStore { store ->
        val initial = testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs"))
        val bound = boundAggregate(initial)
        store.saveWorkbook(initial)

        assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(bound, expectedManifestRevision = 1) }
        assertEquals(initial, store.loadWorkbookBundle())

        store.saveWorkbook(bound, expectedManifestRevision = 0)
        val persisted = store.loadWorkbookBundle()
        assertEquals(1, persisted.manifest.revision)

        val missingBaseline = persisted.copy(dataModels = persisted.dataModels.mapValues { (_, model) ->
            model.copy(name = "Missing baseline")
        })
        assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(missingBaseline) }
        assertEquals(persisted, store.loadWorkbookBundle())

        val forged = persisted.copy(documents = persisted.documents.mapValues { (_, sheet) ->
            sheet.copy(content = sheet.tabularContent.updateCell("B1", "=1"))
        })
        assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(forged) }
        assertEquals(persisted, store.loadWorkbookBundle())

        assertFailsWith<WorkbookApplicationException> {
            store.updateWorkbook(expectedManifestRevision = 0) { current ->
                current.copy(dataModels = current.dataModels.mapValues { (_, model) -> model.copy(name = "Renamed") })
            }
        }
        assertEquals(persisted, store.loadWorkbookBundle())

        val updated = store.updateWorkbook(expectedManifestRevision = 1) { current ->
            current.copy(dataModels = current.dataModels.mapValues { (_, model) -> model.copy(name = "Renamed") })
        }
        assertEquals(2, updated.manifest.revision)
    }

    @Test
    fun `aggregate model changes cannot include unbound sheet edits in SQLite or memory`() {
        val initial = testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs"))
        val unusedModel = boundAggregate(initial).dataModels.values.single()
        val stores = listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore())

        stores.forEach { store ->
            store.useWhenCloseable {
                store.saveWorkbook(initial)
                val before = store.loadWorkbookBundle()

                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook(expectedManifestRevision = before.manifest.revision) { current ->
                        val sheet = current.sheetsInOrder.single()
                        current.copy(dataModels = mapOf(unusedModel.id to unusedModel)).replaceSheet(
                            sheet.rename("Smuggled").updateTabularContent { it.updateCell("A1", "smuggled") },
                        )
                    }
                }

                assertEquals(before, store.loadWorkbookBundle())
            }
        }
    }

    @Test
    fun `initial aggregate saves reject invalid unbound identities in SQLite and memory`() {
        val valid = testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs"))
        val sheet = valid.sheetsInOrder.single()
        val invalid = valid.replaceSheet(sheet.copy(content = TabularContent(
            listOf(RowId("not-a-uuid")) + sheet.tabularContent.rows.drop(1),
            sheet.tabularContent.columns,
            emptyMap(),
        )))
        val stores = listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore())

        stores.forEach { store ->
            store.useWhenCloseable {
                assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(invalid) }
                assertEquals(emptyWorkbookState(), store.loadWorkbookBundle())
            }
        }
    }

    @Test
    fun `model removal persists mechanically pruned presentation in SQLite and memory`() {
        val initial = testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs"))
        val stores = listOf<WorkbookStore>(SqliteWorkbookStore.inMemory(), InMemoryWorkbookStore())

        stores.forEach { store ->
            store.useWhenCloseable {
                store.saveWorkbook(initial)
                val bound = boundAggregate(initial)
                val boundSheet = bound.sheetsInOrder.single()
                val discardedColumn = boundSheet.tabularContent.columns.last()
                store.saveWorkbook(bound, expectedManifestRevision = 0)
                store.writePresentation(
                    ExpectedSheetRevision(boundSheet.id.value, 0),
                    listOf(AxisSizeWrite("column", discardedColumn.value, 42.0)),
                )
                val presented = store.loadWorkbookBundle()

                val model = presented.dataModels.values.single().copy(properties = presented.dataModels.values.single().properties.take(1))
                val reduced = presented.copy(dataModels = mapOf(model.id to model)).replaceSheet(
                    presented.sheetsInOrder.single().copy(
                        content = TabularContent(boundSheet.tabularContent.rows, boundSheet.tabularContent.columns.take(1), emptyMap()),
                        presentation = SheetPresentation(),
                    ),
                )
                store.saveWorkbook(reduced, expectedManifestRevision = 1)

                assertEquals(SheetPresentation(), store.loadWorkbookBundle().sheetsInOrder.single().presentation)
            }
        }
    }

    @Test
    fun `bound append requires a sheet revision baseline and rolls back in SQLite`() = withSqliteStore { store ->
        val initial = testWorkbookOf(testDocument(TEST_SHEET_1, "Inputs"))
        store.saveWorkbook(initial)
        store.saveWorkbook(boundAggregate(initial), expectedManifestRevision = 0)
        val before = store.loadWorkbookBundle()
        val appended = boundAggregateAppend(before)

        assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(appended) }
        assertEquals(before, store.loadWorkbookBundle())
        assertFailsWith<WorkbookApplicationException> { store.updateWorkbook { appended } }
        assertEquals(before, store.loadWorkbookBundle())
        assertFailsWith<WorkbookApplicationException> {
            store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_2, 0)) { appended }
        }
        assertEquals(before, store.loadWorkbookBundle())

        store.updateWorkbook(ExpectedSheetRevision(TEST_SHEET_1, before.sheetsInOrder.single().revision)) { appended }
        assertEquals(appended.sheetsInOrder.single().tabularContent.rows, store.loadWorkbookBundle().sheetsInOrder.single().tabularContent.rows)
    }
}

private inline fun WorkbookStore.useWhenCloseable(block: () -> Unit) {
    try {
        block()
    } finally {
        (this as? AutoCloseable)?.close()
    }
}

private fun boundAggregate(workbook: WorkbookState): WorkbookState {
    val sheet = workbook.sheetsInOrder.single()
    val model = DataModel(
        "00000000-0000-0000-0000-000000000301",
        "Metrics",
        listOf(
            ManualDataModelProperty("00000000-0000-0000-0000-000000000302", "Amount", DataModelPropertyType.FLOAT),
            CalculatedDataModelProperty("00000000-0000-0000-0000-000000000303", "Double", "=@A[1]*2", DataModelPropertyType.FLOAT),
        ),
    )
    val content = sheet.tabularContent
    val columns = content.columns.take(model.properties.size)
    return workbook.copy(dataModels = mapOf(model.id to model)).replaceSheet(sheet.copy(
        dataModelId = model.id,
        content = TabularContent(content.rows, columns, content.rows.associate { row ->
            CellCoordinate(row, columns[1]) to "=@${columns[0].value}[${row.value}]*2"
        }),
    ))
}

private fun boundAggregateAppend(workbook: WorkbookState): WorkbookState {
    val sheet = workbook.sheetsInOrder.single()
    val content = sheet.tabularContent.appendRow(RowId.generate())
    val provisional = workbook.replaceSheet(sheet.copy(content = content))
    val coordinate = CellCoordinate(content.rows.last(), content.columns[1])
    val formula = (workbook.dataModels.values.single().properties[1] as CalculatedDataModelProperty).formula
    return provisional.replaceSheet(provisional.sheetsInOrder.single().copy(content = TabularContent(
        content.rows,
        content.columns,
        content.cellContents + (coordinate to (materializeModelFormula(formula, provisional, sheet.id, coordinate)
            ?: error("Calculated row must materialize"))),
    )))
}
