package com.sheetspace

import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Structural changes preserve persisted instances instead of rebinding their targets. */
class CalculatedAggregateChangeRuleTest {
    @Test
    fun `deleting a referenced sheet succeeds and retains the dependent calculated cell`() = withSqliteStore { store ->
        val workbook = crossSheetWorkbook()
        store.saveWorkbook(workbook)
        val application = DefaultWorkbookApplication(store)
        val source = workbook.sheetsInOrder.first()

        application.deleteSheet(source.id.value, source.revision)

        val saved = store.loadWorkbookBundle()
        val target = saved.sheetsInOrder.single()
        assertEquals(
            workbook.sheetsInOrder.last().tabularContent.rows.map { row ->
                workbook.sheetsInOrder.last().tabularContent.cellContents[CellCoordinate(row, target.modelColumnBindings.getValue(TARGET_TOTAL))]
            },
            target.tabularContent.rows.map { row ->
                target.tabularContent.cellContents[CellCoordinate(row, target.modelColumnBindings.getValue(TARGET_TOTAL))]
            },
        )
    }

    @Test
    fun `unbinding a referenced sheet succeeds through the lifecycle transition with the dependent cell retained`() = withSqliteStore { store ->
        val workbook = crossSheetWorkbook()
        store.saveWorkbook(workbook)
        val application = DefaultWorkbookApplication(store)
        val source = workbook.sheetsInOrder.first()
        val target = workbook.sheetsInOrder.last()
        val unbound = source.copy(modelId = null, modelColumnBindings = emptyMap(), modelFormulaBindings = null)
        val after = workbook.replaceSheet(unbound)

        val saved = application.saveModelLifecycle(workbook, after)

        val persisted = saved.sheetsInOrder.last()
        assertEquals(
            target.tabularContent.rows.map { row -> target.tabularContent.cellContents[CellCoordinate(row, target.modelColumnBindings.getValue(TARGET_TOTAL))] },
            persisted.tabularContent.rows.map { row ->
                persisted.tabularContent.cellContents[CellCoordinate(row, persisted.modelColumnBindings.getValue(TARGET_TOTAL))]
            },
        )
        assertEquals(null, saved.sheetsInOrder.first().modelId)
    }

    @Test
    fun `a lifecycle transition that adds a row persists a complete state that later operations accept`() = withSqliteStore { store ->
        val workbook = crossSheetWorkbook()
        store.saveWorkbook(workbook)
        val application = DefaultWorkbookApplication(store)
        val source = workbook.sheetsInOrder.first()
        val target = workbook.sheetsInOrder.last()
        val addedRow = RowId.generate()
        val output = target.modelColumnBindings.getValue(TARGET_TOTAL)
        val withAddedRow = target.copy(
            content = TabularContent(
                target.tabularContent.rows + addedRow,
                target.tabularContent.columns,
                target.tabularContent.cellContents + (CellCoordinate(addedRow, output) to
                    derivedInstance(source, source.tabularContent.columns[0], source.tabularContent.rows[2])),
            ),
        )
        val after = workbook.replaceSheet(withAddedRow)

        val saved = application.saveModelLifecycle(workbook, after)

        assertTrue(calculatedContentsAreDerived(saved))
        val persisted = saved.sheetsInOrder.last()
        assertEquals(3, persisted.tabularContent.rows.size)

        val renamed = application.updateSheet(persisted.id.value, persisted.revision, UpdateSheetCommand(name = "Renamed"))
        assertEquals("Renamed", renamed.name)

        val appended = application.appendRow(persisted.id.value, application.loadSheet(persisted.id.value).revision)
        assertEquals(4, appended.sheet.tabularContent.rows.size)

        val current = application.loadWorkbookBundle()
        val modelChanged = application.saveModelLifecycle(
            current,
            current.copy(
                dataModels = current.dataModels + (TARGET_MODEL to current.dataModels.getValue(TARGET_MODEL).copy(name = "Renamed")),
            ),
        )
        assertEquals("Renamed", modelChanged.dataModels.getValue(TARGET_MODEL).name)

        application.deleteSheet(saved.sheetsInOrder.first().id.value, application.loadSheet(saved.sheetsInOrder.first().id.value).revision)
        assertEquals(1, application.loadWorkbookBundle().sheetsInOrder.size)
    }

    @Test
    fun `an aggregate update that changes a calculated cell to an unrelated value is rejected`() = withSqliteStore { store ->
        val workbook = crossSheetWorkbook()
        store.saveWorkbook(workbook)
        val target = workbook.sheetsInOrder.last()
        val output = target.modelColumnBindings.getValue(TARGET_TOTAL)
        val coordinate = CellCoordinate(target.tabularContent.rows.first(), output)

        val rejected = assertFailsWith<WorkbookApplicationException> {
            store.updateWorkbook { current ->
                current.replaceSheet(
                    current.documents.getValue(target.id).updateTabularContent { content ->
                        content.updateCell(content.addressOf(coordinate)!!, "=override")
                    },
                )
            }
        }

        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejected.error)
        assertEquals(workbook, store.loadWorkbookBundle())
    }

    @Test
    fun `an unchanged calculated cell is not constrained by a derived instance that changed elsewhere`() {
        val workbook = crossSheetWorkbook()
        val target = workbook.sheetsInOrder.last()
        val output = target.modelColumnBindings.getValue(TARGET_TOTAL)
        val coordinate = CellCoordinate(target.tabularContent.rows.first(), output)
        val overridden = workbook.replaceSheet(
            target.updateTabularContent { content -> content.updateCell(content.addressOf(coordinate)!!, "=override") },
        )
        val removed = workbook.removeSheet(workbook.sheetsInOrder.first().id)

        assertTrue(calculatedOverridesWereIntroduced(workbook, overridden))
        assertFalse(calculatedOverridesWereIntroduced(workbook, removed))
    }

    @Test
    fun `a calculated cell of a new sheet must carry its derived instance`() {
        val workbook = crossSheetWorkbook()
        val target = workbook.sheetsInOrder.last()
        val withoutTarget = workbook.removeSheet(target.id)
        val coordinate = CellCoordinate(target.tabularContent.rows.first(), target.modelColumnBindings.getValue(TARGET_TOTAL))
        val overridden = workbook.replaceSheet(
            target.updateTabularContent { content -> content.updateCell(content.addressOf(coordinate)!!, "=override") },
        )

        assertFalse(calculatedOverridesWereIntroduced(withoutTarget, workbook))
        assertTrue(calculatedOverridesWereIntroduced(withoutTarget, overridden))
    }

    @Test
    fun `a bound calculated property without its template is invalid`() {
        val workbook = crossSheetWorkbook()
        val target = workbook.sheetsInOrder.last()

        assertTrue(calculatedOverridesWereIntroduced(workbook, workbook.replaceSheet(target.copy(modelFormulaBindings = emptyMap()))))
        assertTrue(calculatedOverridesWereIntroduced(workbook, workbook.replaceSheet(target.copy(modelFormulaBindings = null))))
    }

    @Test
    fun `an aggregate update that binds a calculated property without its template is rejected`() = withSqliteStore { store ->
        val workbook = crossSheetWorkbook()
        store.saveWorkbook(workbook)
        val target = workbook.sheetsInOrder.last()

        val rejected = assertFailsWith<WorkbookApplicationException> {
            store.updateWorkbook { current ->
                val sheet = current.documents.getValue(target.id)
                val model = DataModel(
                    NEW_MODEL,
                    "New",
                    listOf(CalculatedModelColumn(NEW_CALCULATED, "New", ModelColumnType.FLOAT, "=1")),
                )
                current.copy(dataModels = current.dataModels + (NEW_MODEL to model)).replaceSheet(
                    sheet.copy(
                        modelId = NEW_MODEL,
                        modelColumnBindings = mapOf(NEW_CALCULATED to sheet.tabularContent.columns[0]),
                        modelFormulaBindings = emptyMap(),
                    ),
                )
            }
        }

        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejected.error)
        assertEquals(workbook, store.loadWorkbookBundle())
    }

    @Test
    fun `materializing derived contents leaves a calculated property that carries no template untouched`() {        val workbook = crossSheetWorkbook()
        val target = workbook.sheetsInOrder.last()
        val unbound = workbook.replaceSheet(target.copy(modelColumnBindings = target.modelColumnBindings - TARGET_TOTAL))
        val withoutTemplate = workbook.replaceSheet(target.copy(modelFormulaBindings = emptyMap()))

        listOf(unbound, withoutTemplate).forEach { state ->
            val materialized = materializeDerivedContents(state)
            assertEquals(
                state.documents.getValue(target.id).tabularContent.cellContents,
                materialized.documents.getValue(target.id).tabularContent.cellContents,
            )
        }
    }
}

private const val SOURCE_MODEL = "32000000-0000-0000-0000-000000000001"
private const val SOURCE_TOTAL = "32000000-0000-0000-0000-000000000002"
private const val TARGET_MODEL = "32000000-0000-0000-0000-000000000003"
private const val TARGET_INPUT = "32000000-0000-0000-0000-000000000004"
private const val TARGET_TOTAL = "32000000-0000-0000-0000-000000000005"
private const val SOURCE_SHEET = "32000000-0000-0000-0000-000000000010"
private const val TARGET_SHEET = "32000000-0000-0000-0000-000000000011"
private const val NEW_MODEL = "32000000-0000-0000-0000-000000000020"
private const val NEW_CALCULATED = "32000000-0000-0000-0000-000000000021"
private const val TARGET_FORMULA = "=@Source!'Total'[1]"

private fun crossSheetWorkbook(): WorkbookState {
    val sourceRows = listOf(RowId.generate(), RowId.generate(), RowId.generate())
    val sourceColumn = ColumnId.generate()
    val source = SheetDocument(
        id = SheetId(SOURCE_SHEET),
        name = "Source",
        content = TabularContent(sourceRows, listOf(sourceColumn), mapOf(CellCoordinate(sourceRows[0], sourceColumn) to "10")),
        modelId = SOURCE_MODEL,
        modelColumnBindings = mapOf(SOURCE_TOTAL to sourceColumn),
    )
    val targetRows = listOf(RowId.generate(), RowId.generate())
    val targetColumns = listOf(ColumnId.generate(), ColumnId.generate())
    val target = SheetDocument(
        id = SheetId(TARGET_SHEET),
        name = "Target",
        content = TabularContent(
            targetRows,
            targetColumns,
            mapOf(
                CellCoordinate(targetRows[0], targetColumns[0]) to "5",
                CellCoordinate(targetRows[0], targetColumns[1]) to derivedInstance(source, sourceColumn, sourceRows[0]),
                CellCoordinate(targetRows[1], targetColumns[1]) to derivedInstance(source, sourceColumn, sourceRows[1]),
            ),
        ),
        modelId = TARGET_MODEL,
        modelColumnBindings = mapOf(TARGET_INPUT to targetColumns[0], TARGET_TOTAL to targetColumns[1]),
        modelFormulaBindings = mapOf(TARGET_TOTAL to sourceTemplate(sourceColumn.value, sourceRows[0].value)),
    )
    return emptyWorkbookState().addSheet(source).addSheet(target).copy(
        dataModels = mapOf(
            SOURCE_MODEL to DataModel(SOURCE_MODEL, "Source", listOf(ManualModelColumn(SOURCE_TOTAL, "Total", ModelColumnType.FLOAT))),
            TARGET_MODEL to DataModel(
                TARGET_MODEL,
                "Target",
                listOf(
                    ManualModelColumn(TARGET_INPUT, "Input", ModelColumnType.FLOAT),
                    CalculatedModelColumn(TARGET_TOTAL, "Total", ModelColumnType.FLOAT, TARGET_FORMULA),
                ),
            ),
        ),
    )
}

/** The template the frontend produces for a named property target of another sheet. */
private fun sourceTemplate(sourceColumnId: String, sourceRowId: String): BoundModelFormula = BoundModelFormula(
    StoredFormulaCodec.encode(StoredFormula(TARGET_FORMULA, listOf(FormulaOccurrence(
        "o", FormulaSpan(1, 19), "s",
        listOf(FormulaEndpoint("e", "c", "r", false, false)),
        listOf(
            FormulaSlot("s", "sheet", JsonPrimitive("Source"), "retained", listOf(SOURCE_SHEET)),
            FormulaSlot("c", "property", JsonPrimitive("Total"), "retained", listOf(SOURCE_TOTAL, sourceColumnId)),
            FormulaSlot("r", "row", JsonPrimitive(1), "retained", listOf(sourceRowId)),
        ), listOf(
            FormulaOrigin(1, 2, null), FormulaOrigin(2, 8, "s"), FormulaOrigin(8, 10, null),
            FormulaOrigin(10, 15, "c"), FormulaOrigin(15, 17, null), FormulaOrigin(17, 18, "r"),
            FormulaOrigin(18, 19, null),
        ),
    )))),
)

private fun derivedInstance(source: SheetDocument, sourceColumn: ColumnId, sourceRow: RowId): String =
    instantiateStoredModelFormula(sourceTemplate(sourceColumn.value, source.tabularContent.rows[0].value).content,
        source.tabularContent.rows.indexOf(sourceRow)) { source.tabularContent.rows.map { it.value } }
