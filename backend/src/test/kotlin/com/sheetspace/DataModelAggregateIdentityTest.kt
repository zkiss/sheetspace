package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith

class DataModelAggregateIdentityTest {
    @Test
    fun `bootstrap rejects UUID identities duplicated with different spelling`() {
        val bound = boundWorkbook()
        val sheet = bound.sheetsInOrder.single()
        val model = bound.dataModels.values.single()
        val property = model.properties.first() as ManualDataModelProperty
        val duplicateProperty = property.copy(id = alternateId(property.id).uppercase())
        val duplicateRow = RowId(alternateId(sheet.tabularContent.rows.first().value).uppercase())
        val duplicateColumn = ColumnId(alternateId(sheet.tabularContent.columns.first().value).uppercase())
        val alternateModelId = alternateId(model.id)

        assertFalse(DataModelTransitionPolicy.permitsBootstrap(bound.copy(dataModels = mapOf(
            alternateModelId to model.copy(id = alternateModelId),
            alternateModelId.uppercase() to model.copy(id = alternateModelId.uppercase()),
        ))))
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(bound.copy(dataModels = mapOf(
            model.id to model.copy(properties = model.properties + duplicateProperty),
        ))))
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(bound.replaceSheet(sheet.copy(content = TabularContent(
            sheet.tabularContent.rows + duplicateRow, sheet.tabularContent.columns, sheet.tabularContent.cellContents,
        )))))
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(bound.replaceSheet(sheet.copy(content = TabularContent(
            sheet.tabularContent.rows, sheet.tabularContent.columns + duplicateColumn, sheet.tabularContent.cellContents,
        )))))
    }

    @Test
    fun `transport rejects duplicate normalized aggregate entries before state mutation`() {
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        val initial = testWorkbookOf(sheet)
        val store = InMemoryWorkbookStore(initial)
        val application = DefaultWorkbookApplication(store)
        val alternateSheetId = alternateId(sheet.id.value)
        val document = WorkbookReadTransportAdapter.sheetDocument(sheet).copy(id = alternateSheetId)
        val bundle = WorkbookBundleResponse(
            WorkbookManifestResponse(WORKBOOK_SCHEMA_VERSION, initial.manifest.revision, listOf(alternateSheetId)),
            listOf(document.copy(id = alternateSheetId.uppercase()), document),
            emptyList(),
        )
        val before = store.loadWorkbookBundle()

        val failure = assertFailsWith<WorkbookApplicationException> {
            application.replaceDataModelState(DataModelStateCommand(
                listOf(ExpectedSheetRevision(sheet.id.value, sheet.revision)), bundle, initial.manifest.revision,
            ))
        }

        assertEquals(WorkbookApplicationError.INVALID_CELL_PATCH, failure.error)
        assertEquals(before, store.loadWorkbookBundle())
    }

    @Test
    fun `transport rejects duplicate normalized models before association`() {
        val modelId = alternateId("00000000-0000-0000-0000-000000000101")
        val response = DataModelResponse(modelId, "Model", listOf(
            DataModelPropertyResponse(alternateId("00000000-0000-0000-0000-000000000102"), "Value", "manual", "string"),
        ))

        assertFailsWith<WorkbookApplicationException> {
            dataModelState(WorkbookBundleResponse(
                WorkbookManifestResponse(WORKBOOK_SCHEMA_VERSION, 0, emptyList()),
                emptyList(),
                listOf(response.copy(id = modelId.uppercase()), response),
            ))
        }
    }

    private fun alternateId(id: String): String = id.replaceFirst('0', 'a')
}
