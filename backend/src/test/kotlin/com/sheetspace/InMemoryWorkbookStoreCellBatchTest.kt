package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals

class InMemoryWorkbookStoreCellBatchTest {
    @Test
    fun `calculated model cells reject direct writes without persisting`() {
        val modelId = "00000000-0000-0000-0000-000000000101"
        val content = TabularContent(columnCount = 2)
        val sheet = testDocument(
            TEST_SHEET_1,
            "Inputs",
            tabular = TabularContent(
                content.rows,
                content.columns,
                content.rows.associate { row ->
                    CellCoordinate(row, content.columns[1]) to "=@${content.columns[0].value}[${row.value}]*2"
                },
            ),
        ).copy(dataModelId = modelId)
        val model = DataModel(
            modelId,
            "Inputs",
            listOf(
                ManualDataModelProperty("00000000-0000-0000-0000-000000000102", "Amount", DataModelPropertyType.STRING),
                CalculatedDataModelProperty("00000000-0000-0000-0000-000000000103", "Double", "=@A[1]*2", DataModelPropertyType.FLOAT),
            ),
        )
        val store = InMemoryWorkbookStore()
        store.saveWorkbook(testWorkbookOf(sheet).copy(dataModels = mapOf(modelId to model)))
        val before = store.loadWorkbookBundle()

        val error = kotlin.test.assertFailsWith<WorkbookApplicationException> {
            store.writeCells(
                listOf(ExpectedSheetRevision(sheet.id.value, sheet.revision)),
                listOf(sheet.cellWrite("B1", "=6")),
            )
        }

        assertEquals(WorkbookApplicationError.READ_ONLY_CALCULATED_CELL, error.error)
        assertEquals(before, store.loadWorkbookBundle())
    }
}
