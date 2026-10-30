package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteModelColumnBindingsTest {
    private val modelId = "30000000-0000-0000-0000-000000000001"
    private val revenueId = "31000000-0000-0000-0000-000000000001"
    private val costId = "31000000-0000-0000-0000-000000000002"
    private val freshId = "31000000-0000-0000-0000-000000000003"
    private val model = DataModel(modelId, "Budget", listOf(
        ManualModelColumn(revenueId, "Revenue", ModelColumnType.FLOAT),
        CalculatedModelColumn(costId, "Cost", ModelColumnType.FLOAT, "=1"),
    ))
    private val sheet = testDocument(TEST_SHEET_1, "Inputs", tabular = TabularContent(columnCount = 3, rowCount = 2))
    private val boundSheet = sheet.copy(
        modelId = modelId,
        modelColumnBindings = mapOf(revenueId to sheet.tabularContent.columns[0], costId to sheet.tabularContent.columns[1]),
        modelFormulaBindings = mapOf(costId to BoundModelFormula("=1")),
        content = sheet.tabularContent.updateCell("B1", "=1")
            .updateCell("B2", "=1"),
    )
    private val workbook = testWorkbookOf(boundSheet).copy(dataModels = mapOf(modelId to model))

    @Test
    fun `aggregate save and update retain ordinary column names`() {
        val column = sheet.tabularContent.columns[2].value
        val named = boundSheet.copy(columnNames = mapOf(column to "Owner's cost"))
        SqliteWorkbookStore.inMemory().use { store ->
            store.saveWorkbook(workbook.replaceSheet(named))
            assertEquals(named.columnNames, store.loadSheet(sheet.id)!!.columnNames)

            store.updateWorkbook { current -> current.replaceSheet(current.findSheet(sheet.id)!!.copy(columnNames = mapOf(column to "Cost"))) }
            assertEquals(mapOf(column to "Cost"), store.loadSheet(sheet.id)!!.columnNames)
        }
    }

    @Test
    fun `aggregate save reloads bound identities and sheet reads retain them`() {
        SqliteWorkbookStore.inMemory().use { store ->
            store.saveWorkbook(workbook)

            assertEquals(workbook, store.loadWorkbookBundle())
            assertEquals(boundSheet, store.loadSheet(sheet.id))
        }
    }

    @Test
    fun `declaration replacement retains renamed targets and removes deleted targets without binding fresh IDs`() {
        SqliteWorkbookStore.inMemory().use { store ->
            store.saveWorkbook(workbook)
            val application = DefaultWorkbookApplication(store)
            application.saveDataModel(model.copy(columns = listOf(
                ManualModelColumn(freshId, "Revenue", ModelColumnType.FLOAT),
                CalculatedModelColumn(costId, "Costs", ModelColumnType.FLOAT, "=1"),
            )))

            val reloaded = store.loadSheet(sheet.id)!!
            assertEquals(mapOf(costId to sheet.tabularContent.columns[1]), reloaded.modelColumnBindings)
            assertEquals(boundSheet.content, reloaded.content)
            assertEquals(boundSheet.presentation, reloaded.presentation)
        }
    }

    @Test
    fun `invalid associations are rejected before aggregate replacement or update persists anything`() {
        val invalidSheets = listOf(
            boundSheet.copy(modelId = freshId),
            boundSheet.copy(modelId = null),
            boundSheet.copy(modelColumnBindings = mapOf(freshId to sheet.tabularContent.columns[0])),
            boundSheet.copy(modelColumnBindings = mapOf(revenueId to ColumnId(freshId))),
            boundSheet.copy(modelColumnBindings = mapOf(revenueId to sheet.tabularContent.columns[0], costId to sheet.tabularContent.columns[0])),
        )
        SqliteWorkbookStore.inMemory().use { store ->
            store.saveWorkbook(workbook)
            invalidSheets.forEach { invalid ->
                val replacement = workbook.replaceSheet(invalid)

                assertFailsWith<IllegalArgumentException> { store.saveWorkbook(replacement) }
                assertEquals(workbook, store.loadWorkbookBundle())
                assertFailsWith<IllegalArgumentException> { store.updateWorkbook { replacement } }
                assertEquals(workbook, store.loadWorkbookBundle())
            }
        }
    }
}
