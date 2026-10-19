package com.sheetspace

import kotlin.test.Test
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
