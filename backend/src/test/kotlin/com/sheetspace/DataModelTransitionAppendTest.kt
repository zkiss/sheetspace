package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DataModelTransitionAppendTest {
    @Test
    fun `bound append is globally single sheet and freezes every other sheet`() {
        val first = boundWorkbook()
        val model = first.dataModels.values.single()
        val second = testDocument(TEST_SHEET_2, "Outputs", tabular = TabularContent(rowCount = 2, columnCount = 2))
        val boundSecond = second.copy(dataModelId = model.id, content = TabularContent(
            second.tabularContent.rows,
            second.tabularContent.columns,
            second.tabularContent.rows.associate { row ->
                CellCoordinate(row, second.tabularContent.columns[1]) to
                    "=@${second.tabularContent.columns[0].value}[${row.value}]*2"
            },
        ))
        val before = first.addSheet(boundSecond)
        val firstAppend = appendBoundSheet(before, first.sheetsInOrder.first().id)
        val twoAppends = appendBoundSheet(firstAppend, boundSecond.id)

        assertTrue(DataModelTransitionPolicy.permitsTransition(before, firstAppend))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before, twoAppends))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before, firstAppend.copy(
            manifest = firstAppend.manifest.copy(revision = firstAppend.manifest.revision + 1),
        )))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before, firstAppend.replaceSheet(
            firstAppend.findSheet(boundSecond.id)!!.rename("Smuggled"),
        )))
    }

    @Test
    fun `bound append rejects an edit to an existing cell`() {
        val before = boundWorkbook()
        val appended = appendBoundSheet(before, before.sheetsInOrder.single().id)
        val sheet = appended.sheetsInOrder.single()
        val manualCoordinate = CellCoordinate(sheet.tabularContent.rows.first(), sheet.tabularContent.columns.first())
        val smuggled = appended.replaceSheet(sheet.copy(content = TabularContent(
            sheet.tabularContent.rows,
            sheet.tabularContent.columns,
            sheet.tabularContent.cellContents + (manualCoordinate to "Smuggled"),
        )))

        assertFalse(DataModelTransitionPolicy.permitsTransition(before, smuggled))
    }

    @Test
    fun `bound append rejects an invalid fresh row identity`() {
        val before = boundWorkbook()
        val appended = appendBoundSheet(before, before.sheetsInOrder.single().id)
        val sheet = appended.sheetsInOrder.single()
        val oldRow = sheet.tabularContent.rows.last()
        val invalidRow = RowId("not-a-uuid")
        val invalidContent = TabularContent(
            sheet.tabularContent.rows.dropLast(1) + invalidRow,
            sheet.tabularContent.columns,
            sheet.tabularContent.cellContents.mapKeys { (coordinate, _) ->
                if (coordinate.rowId == oldRow) coordinate.copy(rowId = invalidRow) else coordinate
            },
        )

        assertFalse(DataModelTransitionPolicy.permitsTransition(before, appended.replaceSheet(sheet.copy(content = invalidContent))))
    }

    @Test
    fun `aggregate changes retain their manifest and freeze unaffected sheets`() {
        val bound = boundWorkbook()
        val unrelated = testDocument(TEST_SHEET_2, "Unrelated")
        val before = bound.addSheet(unrelated)
        val renamedModel = before.dataModels.values.single().copy(name = "Renamed")
        val after = before.copy(dataModels = mapOf(renamedModel.id to renamedModel))

        assertTrue(DataModelTransitionPolicy.permitsTransition(before, after))
        assertFalse(DataModelTransitionPolicy.permitsTransition(before, after.copy(
            manifest = after.manifest.copy(revision = after.manifest.revision + 1),
        )))
        assertEquals(setOf(SheetId(TEST_SHEET_1)), DataModelTransitionPolicy.affectedAggregateSheets(before, after.removeSheet(unrelated.id)))
    }

    private fun appendBoundSheet(before: WorkbookState, sheetId: SheetId): WorkbookState {
        val sheet = before.findSheet(sheetId)!!
        val appended = sheet.tabularContent.appendRow(RowId.generate())
        val provisional = before.replaceSheet(sheet.copy(content = appended))
        val coordinate = CellCoordinate(appended.rows.last(), appended.columns[1])
        val formula = before.dataModels.getValue(sheet.dataModelId!!).properties[1] as CalculatedDataModelProperty
        return provisional.replaceSheet(provisional.findSheet(sheetId)!!.copy(content = TabularContent(
            appended.rows,
            appended.columns,
            appended.cellContents + (coordinate to (materializeModelFormula(formula.formula, provisional, sheetId, coordinate)
                ?: error("Calculated row must materialize"))),
        )))
    }
}
