package com.sheetspace

import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals

class WorkbookReadContractTest {
    @Test
    fun `shared workbook read fixture matches backend transport`() {
        val fixtureText = checkNotNull(javaClass.getResource("/workbook-read-contract.json")).readText()
        val expected = testJson.decodeFromString<WorkbookBundleResponse>(fixtureText)
        val actual = WorkbookReadTransportAdapter.bundle(fixtureWorkbook())

        assertEquals(expected, actual)
        assertEquals(
            testJson.parseToJsonElement(fixtureText),
            testJson.parseToJsonElement(testJson.encodeToString(actual)),
        )
    }

    @Test
    fun `transport includes bound data models and calculated property formulas`() {
        val modelId = "00000000-0000-0000-0000-000000000101"
        val sheet = testDocument(TEST_SHEET_1, "Inputs").copy(dataModelId = modelId)
        val workbook = testWorkbookOf(sheet).copy(dataModels = mapOf(modelId to DataModel(
            modelId,
            "Inputs",
            listOf(
                ManualDataModelProperty("00000000-0000-0000-0000-000000000102", "Amount"),
                CalculatedDataModelProperty("00000000-0000-0000-0000-000000000103", "Double", "=@A[1]*2"),
            ),
        )))

        val expected =
            WorkbookBundleResponse(
                WorkbookManifestResponse(WORKBOOK_SCHEMA_VERSION, 0, listOf(sheet.id.value)),
                listOf(WorkbookReadTransportAdapter.sheetDocument(sheet)),
                listOf(DataModelResponse(modelId, "Inputs", listOf(
                    DataModelPropertyResponse("00000000-0000-0000-0000-000000000102", "Amount", "manual"),
                    DataModelPropertyResponse("00000000-0000-0000-0000-000000000103", "Double", "calculated", "=@A[1]*2"),
                ))),
            )
        val actual = WorkbookReadTransportAdapter.bundle(workbook)

        assertEquals(expected, actual)
        assertEquals(expected, testJson.decodeFromString(testJson.encodeToString(actual)))

        val model = actual.dataModels.single()
        assertEquals(modelId, model.id)
        assertEquals("Inputs", model.name)
        assertEquals(listOf("manual", "calculated"), model.properties.map { it.kind })
        assertEquals(listOf(null, "=@A[1]*2"), model.properties.map { it.formula })
        assertEquals(listOf("Amount", "Double"), model.properties.map { it.name })
        assertEquals(
            listOf("00000000-0000-0000-0000-000000000102", "00000000-0000-0000-0000-000000000103"),
            model.properties.map { it.id },
        )
    }
}

private fun fixtureWorkbook(): WorkbookState {
    val outputs = SheetDocument(
        id = SheetId(TEST_SHEET_2),
        revision = 4,
        name = "Outputs",
        frame = FrameState(
            position = WorkspacePosition(420.0, 260.0),
            size = SheetFrameSize(300.0, 180.0),
            visualScale = 0.5,
            zIndex = 2,
        ),
        content = TabularContent(
            rows = listOf(RowId("20000000-0000-0000-0000-000000000001")),
            columns = listOf(ColumnId("21000000-0000-0000-0000-000000000001")),
            cellContents = mapOf(
                CellCoordinate(
                    RowId("20000000-0000-0000-0000-000000000001"),
                    ColumnId("21000000-0000-0000-0000-000000000001"),
                ) to
                    "=SUM(@00000000-0000-0000-0000-000000000001!" +
                    "11000000-0000-0000-0000-000000000001[10000000-0000-0000-0000-000000000001]:" +
                    "11000000-0000-0000-0000-000000000002[10000000-0000-0000-0000-000000000002])",
            ),
        ),
    )
    val inputRows = listOf(
        RowId("10000000-0000-0000-0000-000000000001"),
        RowId("10000000-0000-0000-0000-000000000002"),
    )
    val inputColumns = listOf(
        ColumnId("11000000-0000-0000-0000-000000000001"),
        ColumnId("11000000-0000-0000-0000-000000000002"),
    )
    val inputs = SheetDocument(
        id = SheetId(TEST_SHEET_1),
        revision = 3,
        name = "Inputs",
        frame = FrameState(
            position = WorkspacePosition(12.5, -8.25),
            size = SheetFrameSize(360.0, 240.0),
            visualScale = 2.0,
            zIndex = 1,
        ),
        content = TabularContent(
            rows = inputRows,
            columns = inputColumns,
            cellContents = mapOf(
                CellCoordinate(inputRows[0], inputColumns[0]) to "Region",
                CellCoordinate(inputRows[0], inputColumns[1]) to "10",
                CellCoordinate(inputRows[1], inputColumns[1]) to "5",
            ),
        ),
    )
    val manifest = WorkbookManifest(
        revision = 7,
        sheetIds = listOf(outputs.id, inputs.id),
    )
    return WorkbookState(manifest, mapOf(inputs.id to inputs, outputs.id to outputs))
}
