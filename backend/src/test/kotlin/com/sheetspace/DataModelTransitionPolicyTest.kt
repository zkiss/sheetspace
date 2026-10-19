package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DataModelTransitionPolicyTest {
    @Test
    fun `bootstrap accepts empty and complete model-owned workbooks but rejects forged calculated cells`() {
        val bound = boundWorkbook()

        assertTrue(DataModelTransitionPolicy.permitsBootstrap(emptyWorkbookState()))
        assertTrue(DataModelTransitionPolicy.permitsBootstrap(bound))
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(bound.withCalculatedRaw("=1")))
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(bound.copy(dataModels = mapOf("bad" to bound.dataModels.values.single()))))
    }

    @Test
    fun `identity validation rejects malformed model and sheet declarations`() {
        val bound = boundWorkbook()
        val model = bound.dataModels.values.single()
        val sheet = bound.sheetsInOrder.single()
        val invalid = listOf(
            bound.copy(manifest = bound.manifest.copy(version = 0)),
            bound.copy(dataModels = mapOf("bad" to model)),
            bound.copy(dataModels = mapOf(model.id to model.copy(id = "bad"))),
            bound.copy(dataModels = mapOf(model.id to model.copy(name = " "))),
            bound.copy(dataModels = mapOf(model.id to model.copy(properties = model.properties + model.properties.first()))),
            bound.copy(dataModels = mapOf(model.id to model.copy(properties = model.properties.mapIndexed { index, property ->
                if (index == 0) (property as ManualDataModelProperty).copy(id = "bad") else property
            }))),
            bound.copy(dataModels = mapOf(model.id to model.copy(properties = model.properties.mapIndexed { index, property ->
                if (index == 0) (property as ManualDataModelProperty).copy(name = " ") else property
            }))),
            bound.copy(dataModels = mapOf(model.id to model.copy(properties = model.properties.mapIndexed { index, property ->
                if (index == 1) (property as CalculatedDataModelProperty).copy(name = "amount") else property
            }))),
            WorkbookState(
                WorkbookManifest(sheetIds = listOf(SheetId("bad"))),
                mapOf(SheetId("bad") to sheet.copy(id = SheetId("bad"))),
                bound.dataModels,
            ),
        )

        invalid.forEach { assertFalse(DataModelTransitionPolicy.permitsBootstrap(it)) }
    }

    @Test
    fun `bootstrap validates nonempty unbound sheets and binding references`() {
        val plain = plainWorkbook()
        val sheet = plain.sheetsInOrder.single()
        val model = boundWorkbook(plain).dataModels.values.single()

        assertTrue(DataModelTransitionPolicy.permitsBootstrap(plain))
        assertTrue(DataModelTransitionPolicy.permitsBootstrap(plain.copy(dataModels = mapOf(model.id to model))))
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(plain.replaceSheet(sheet.copy(dataModelId = "missing"))))
    }

    @Test
    fun `ordinary changes pass while model transitions require unchanged aggregate topology`() {
        val bound = boundWorkbook()
        val renamed = bound.replaceSheet(bound.sheetsInOrder.single().rename("Renamed"))
        val changedModel = bound.copy(dataModels = bound.dataModels.mapValues { (_, model) -> model.copy(name = "Changed") })

        assertTrue(DataModelTransitionPolicy.permitsTransition(bound, renamed))
        assertFalse(DataModelTransitionPolicy.permitsTransition(bound, changedModel.copy(manifest = changedModel.manifest.copy(revision = 1))))
        assertFalse(DataModelTransitionPolicy.permitsTransition(bound, changedModel.copy(dataModels = mapOf("bad" to changedModel.dataModels.values.single()))))
        assertFalse(DataModelTransitionPolicy.permitsTransition(
            bound.copy(manifest = bound.manifest.copy(version = WORKBOOK_SCHEMA_VERSION + 1)),
            changedModel,
        ))
    }

    @Test
    fun `binding requires model shape and canonical calculated contents`() {
        val unbound = plainWorkbook()
        val bound = boundWorkbook(unbound)

        assertTrue(DataModelTransitionPolicy.permitsTransition(unbound, bound))
        assertFalse(DataModelTransitionPolicy.permitsTransition(unbound, bound.withCalculatedRaw("=1")))
        assertFalse(DataModelTransitionPolicy.permitsTransition(unbound, bound.replaceSheet(
            bound.sheetsInOrder.single().updateTabularContent(TabularContent::appendColumn),
        )))
        assertFalse(DataModelTransitionPolicy.permitsTransition(unbound, bound.replaceSheet(
            bound.sheetsInOrder.single().copy(content = TabularContent(
                bound.sheetsInOrder.single().tabularContent.rows + RowId.generate(),
                bound.sheetsInOrder.single().tabularContent.columns,
                bound.sheetsInOrder.single().tabularContent.cellContents,
            )),
        )))
    }

    @Test
    fun `unbind preserves manual cells and replaces calculated formulas with scalars`() {
        val bound = boundWorkbook()
        val sheet = bound.sheetsInOrder.single()
        val scalar = bound.replaceSheet(sheet.copy(dataModelId = null, content = TabularContent(
            sheet.tabularContent.rows,
            sheet.tabularContent.columns,
            sheet.tabularContent.cellContents.mapValues { (coordinate, raw) ->
                if (coordinate.columnId == sheet.tabularContent.columns[1]) "10" else raw
            },
        )))

        assertTrue(DataModelTransitionPolicy.permitsTransition(bound, scalar))
        assertFalse(DataModelTransitionPolicy.permitsTransition(bound, scalar.replaceSheet(
            scalar.sheetsInOrder.single().updateTabularContent { it.updateCell("A1", "smuggled") },
        )))
        assertFalse(DataModelTransitionPolicy.permitsTransition(bound, scalar.withCalculatedRaw("=1")))
        assertTrue(DataModelTransitionPolicy.permitsTransition(bound, scalar.replaceSheet(
            scalar.sheetsInOrder.single().copy(content = TabularContent(
                scalar.sheetsInOrder.single().tabularContent.rows,
                scalar.sheetsInOrder.single().tabularContent.columns,
                scalar.sheetsInOrder.single().tabularContent.cellContents.filterKeys {
                    it.columnId != scalar.sheetsInOrder.single().tabularContent.columns[1]
                },
            )),
        )))
        assertFalse(DataModelTransitionPolicy.permitsTransition(bound, scalar.replaceSheet(
            scalar.sheetsInOrder.single().copy(name = "Renamed"),
        )))
        assertFalse(DataModelTransitionPolicy.permitsTransition(bound, scalar.replaceSheet(
            scalar.sheetsInOrder.single().copy(frame = FrameState(position = WorkspacePosition(1.0, 1.0))),
        )))
        assertFalse(DataModelTransitionPolicy.permitsTransition(bound, scalar.replaceSheet(
            scalar.sheetsInOrder.single().copy(presentation = SheetPresentation(rowHeights = mapOf("1" to 42.0))),
        )))
        assertFalse(DataModelTransitionPolicy.permitsTransition(bound, scalar.replaceSheet(
            scalar.sheetsInOrder.single().copy(content = TabularContent(
                scalar.sheetsInOrder.single().tabularContent.rows.dropLast(1),
                scalar.sheetsInOrder.single().tabularContent.columns,
                emptyMap(),
            )),
        )))
        assertFalse(DataModelTransitionPolicy.permitsTransition(bound, scalar.replaceSheet(
            scalar.sheetsInOrder.single().copy(content = TabularContent(
                scalar.sheetsInOrder.single().tabularContent.rows,
                scalar.sheetsInOrder.single().tabularContent.columns.dropLast(1),
                emptyMap(),
            )),
        )))
    }

    @Test
    fun `bound updates retain property columns and allow only row append calculated ownership`() {
        val before = boundWorkbook()
        val sheet = before.sheetsInOrder.single()
        val appendedRow = RowId.generate()
        val appended = sheet.tabularContent.appendRow(appendedRow)
        val afterWithoutCalculated = before.replaceSheet(sheet.copy(content = appended))
        val calculated = CellCoordinate(appendedRow, appended.columns[1])
        val after = afterWithoutCalculated.replaceSheet(afterWithoutCalculated.sheetsInOrder.single().copy(content = TabularContent(
            appended.rows,
            appended.columns,
            appended.cellContents + (calculated to (materializeModelFormula(
                (before.dataModels.values.single().properties[1] as CalculatedDataModelProperty).formula,
                afterWithoutCalculated,
                sheet.id,
                calculated,
            ) ?: error("Calculated row must materialize"))),
        )))
        val renamedModel = before.dataModels.values.single().copy(properties = before.dataModels.values.single().properties.map {
            when (it) {
                is ManualDataModelProperty -> it.copy(name = "Renamed amount")
                is CalculatedDataModelProperty -> it.copy(name = "Renamed double")
            }
        })

        assertTrue(DataModelTransitionPolicy.permitsTransition(before, after))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before, after.withCalculatedRaw("=1")))
        assertTrue(DataModelTransitionPolicy.permitsTransition(before, before.copy(dataModels = mapOf(renamedModel.id to renamedModel))))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before, before.copy(
            dataModels = mapOf(renamedModel.id to renamedModel),
        ).replaceSheet(sheet.copy(
            presentation = SheetPresentation(columnWidths = mapOf(sheet.tabularContent.columns.first().value to 42.0)),
        ))))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before, before.copy(
            dataModels = mapOf(renamedModel.id to renamedModel),
        ).replaceSheet(sheet.copy(frame = FrameState(position = WorkspacePosition(1.0, 1.0))))))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before, before.copy(
            dataModels = mapOf(renamedModel.id to renamedModel),
        ).replaceSheet(sheet.copy(content = TabularContent(
            sheet.tabularContent.rows.reversed(), sheet.tabularContent.columns, sheet.tabularContent.cellContents,
        )))))
    }

    @Test
    fun `bound model changes reject mismatched bindings and preserve stable columns`() {
        val before = boundWorkbook()
        val sheet = before.sheetsInOrder.single()
        val model = before.dataModels.values.single()
        val otherId = "00000000-0000-0000-0000-000000000104"
        val other = model.copy(id = otherId)
        val withDifferentBinding = before.copy(dataModels = before.dataModels + (otherId to other)).replaceSheet(sheet.copy(dataModelId = otherId))
        val addedProperty = ManualDataModelProperty("00000000-0000-0000-0000-000000000105", "Added", DataModelPropertyType.STRING)
        val addedModel = model.copy(properties = model.properties + addedProperty)
        val appendedColumn = sheet.tabularContent.appendColumn()
        val validAddition = before.copy(dataModels = mapOf(model.id to addedModel)).replaceSheet(sheet.copy(content = appendedColumn))
        val shiftedColumns = sheet.copy(content = TabularContent(
            sheet.tabularContent.rows,
            sheet.tabularContent.columns.reversed(),
            sheet.tabularContent.cellContents,
        ))

        assertFalse(DataModelTransitionPolicy.permitsTransition(before, withDifferentBinding))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before.withCalculatedRaw("=1"), before.copy(
            dataModels = mapOf(model.id to model.copy(name = "Changed")),
        )))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before, before.copy(dataModels = mapOf(model.id to addedModel))))
        assertTrue(DataModelTransitionPolicy.permitsTransition(before, validAddition))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before, before.copy(dataModels = mapOf(model.id to model.copy(name = "Changed"))).replaceSheet(shiftedColumns)))
    }
}

private fun plainWorkbook(): WorkbookState = testWorkbookOf(testDocument(
    TEST_SHEET_1,
    "Inputs",
    tabular = TabularContent(rowCount = 2, columnCount = 2),
))

private fun boundWorkbook(plain: WorkbookState = plainWorkbook()): WorkbookState {
    val sheet = plain.sheetsInOrder.single()
    val model = DataModel(
        "00000000-0000-0000-0000-000000000101",
        "Metrics",
        listOf(
            ManualDataModelProperty("00000000-0000-0000-0000-000000000102", "Amount", DataModelPropertyType.FLOAT),
            CalculatedDataModelProperty("00000000-0000-0000-0000-000000000103", "Double", "=@A[1]*2", DataModelPropertyType.FLOAT),
        ),
    )
    val provisional = plain.copy(dataModels = mapOf(model.id to model)).replaceSheet(sheet.copy(dataModelId = model.id))
    val content = sheet.tabularContent
    val cells = content.rows.associate { row ->
        val coordinate = CellCoordinate(row, content.columns[1])
        coordinate to "=@${content.columns[0].value}[${row.value}]*2"
    }
    return provisional.replaceSheet(provisional.sheetsInOrder.single().copy(content = TabularContent(content.rows, content.columns, cells)))
}

private fun WorkbookState.withCalculatedRaw(raw: String): WorkbookState {
    val sheet = sheetsInOrder.single()
    return replaceSheet(sheet.copy(content = TabularContent(
        sheet.tabularContent.rows,
        sheet.tabularContent.columns,
        sheet.tabularContent.cellContents.mapValues { (coordinate, value) ->
            if (coordinate.columnId == sheet.tabularContent.columns[1]) raw else value
        },
    )))
}
