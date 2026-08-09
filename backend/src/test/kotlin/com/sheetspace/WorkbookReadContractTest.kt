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
}

private fun fixtureWorkbook(): WorkbookState {
    val outputs = SheetDocument(
        id = SheetId(TEST_SHEET_2),
        revision = 4,
        name = "Outputs",
        frame = FrameState(
            position = WorkspacePosition(420.0, 260.0),
            size = SheetFrameSize(300.0, 180.0),
            zIndex = 2,
        ),
        content = TabularContent(
            rows = listOf(RowId("20000000-0000-0000-0000-000000000001")),
            columns = listOf(ColumnId("21000000-0000-0000-0000-000000000001")),
            cellContents = mapOf(
                CellCoordinate(
                    RowId("20000000-0000-0000-0000-000000000001"),
                    ColumnId("21000000-0000-0000-0000-000000000001"),
                ) to "=SUM(00000000-0000-0000-0000-000000000001!A1:B2)",
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
            zIndex = 1,
        ),
        content = TabularContent(
            rows = inputRows,
            columns = inputColumns,
            cellContents = mapOf(
                CellCoordinate(inputRows[1], inputColumns[1]) to "5",
                CellCoordinate(inputRows[0], inputColumns[1]) to "10",
                CellCoordinate(inputRows[0], inputColumns[0]) to "Region",
            ),
        ),
    )
    val manifest = WorkbookManifest(
        revision = 7,
        sheetIds = listOf(outputs.id, inputs.id),
    )
    return WorkbookState(manifest, mapOf(inputs.id to inputs, outputs.id to outputs))
}
