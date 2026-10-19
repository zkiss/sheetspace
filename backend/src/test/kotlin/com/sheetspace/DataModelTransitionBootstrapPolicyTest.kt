package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DataModelTransitionBootstrapPolicyTest {
    @Test
    fun `binding requires newly introduced manual columns to be empty`() {
        val unbound = plainWorkbook()
        val originalBound = boundWorkbook(unbound)
        val originalModel = originalBound.dataModels.values.single()
        val originalSheet = originalBound.sheetsInOrder.single()
        val model = originalModel.copy(
            properties = originalModel.properties + ManualDataModelProperty(
                "00000000-0000-0000-0000-000000000198", "New input", DataModelPropertyType.STRING,
            ),
        )
        val bound = originalBound.copy(dataModels = mapOf(model.id to model)).replaceSheet(
            originalSheet.copy(content = TabularContent(
                originalSheet.tabularContent.rows,
                originalSheet.tabularContent.columns + ColumnId.generate(),
                originalSheet.tabularContent.cellContents,
            )),
        )
        val addedColumn = bound.sheetsInOrder.single().tabularContent.columns.last()
        val row = bound.sheetsInOrder.single().tabularContent.rows.first()
        val smuggled = bound.replaceSheet(bound.sheetsInOrder.single().copy(content = TabularContent(
            bound.sheetsInOrder.single().tabularContent.rows,
            bound.sheetsInOrder.single().tabularContent.columns,
            bound.sheetsInOrder.single().tabularContent.cellContents + (CellCoordinate(row, addedColumn) to "smuggled"),
        )))

        assertTrue(DataModelTransitionPolicy.permitsTransition(unbound, bound))
        assertFalse(DataModelTransitionPolicy.permitsTransition(unbound, smuggled))
    }

    @Test
    fun `bootstrap validates calculated definitions without bound rows`() {
        val model = boundWorkbook().dataModels.values.single()
        val malformed = model.copy(properties = model.properties.map { property ->
            if (property is CalculatedDataModelProperty) property.copy(formula = "not a formula") else property
        })

        assertFalse(DataModelTransitionPolicy.permitsBootstrap(emptyWorkbookState().copy(dataModels = mapOf(malformed.id to malformed))))
    }

    @Test
    fun `transitions validate changed calculated definitions`() {
        val before = boundWorkbook()
        val model = before.dataModels.values.single()
        val invalid = before.copy(dataModels = mapOf(model.id to model.copy(properties = model.properties.map { property ->
            if (property is CalculatedDataModelProperty) property.copy(formula = "invalid") else property
        })))

        assertFalse(DataModelTransitionPolicy.permitsTransition(before, invalid))
    }

    @Test
    fun `binding derives a newly introduced calculated column`() {
        val after = boundWorkbook()
        val sheet = after.sheetsInOrder.single()
        val before = after.copy(dataModels = emptyMap()).replaceSheet(sheet.copy(
            dataModelId = null,
            content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns.take(1), emptyMap()),
        ))

        assertTrue(DataModelTransitionPolicy.permitsTransition(before, after))
    }

    @Test
    fun `in memory construction validates the initial aggregate`() {
        val plain = plainWorkbook()
        val invalid = plain.replaceSheet(plain.sheetsInOrder.single().copy(content = TabularContent(
            listOf(RowId("not-a-uuid")), emptyList(), emptyMap(),
        )))

        assertFailsWith<IllegalArgumentException> { InMemoryWorkbookStore(invalid) }
    }
}
