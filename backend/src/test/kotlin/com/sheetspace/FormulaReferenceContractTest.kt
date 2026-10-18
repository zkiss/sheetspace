package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FormulaReferenceContractTest {
    @Test fun `accepts and canonicalizes a relative A1 formula`() {
        val content = TabularContent(cells = mapOf("A1" to "value"))
        assertTrue(FormulaReferenceContract.isFormula("=@A[1]*2"))
        val (workbook, sheet) = workbook(content)
        assertEquals("=@${content.columns.first().value}[${content.rows.first().value}]*2", FormulaReferenceContract.canonicalize("=@A[1]*2", workbook, sheet))
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@Z[999]", workbook, sheet))
    }

    @Test fun `rejects incomplete syntax while preserving literal reference text`() {
        val content = TabularContent(cells = mapOf("A1" to "value"))
        assertTrue(!FormulaReferenceContract.isFormula("=1+"))
        val (workbook, sheet) = workbook(content)
        assertEquals("=\"@A[1]\"", FormulaReferenceContract.canonicalize("=\"@A[1]\"", workbook, sheet))
        assertTrue(FormulaReferenceContract.isFormula("=#REF!"))
    }

    @Test fun `recognizes supported expression forms without treating malformed text as formulas`() {
        assertTrue(FormulaReferenceContract.isFormula("=SUM(1, -2.5e+1, TRUE, (FALSE)) >= 0"))
        assertTrue(FormulaReferenceContract.isFormula("=\"a \"\"quoted\"\" @A[1]\""))
        assertTrue(FormulaReferenceContract.isFormula("=@A[1]:\$B[\$2]"))
        assertTrue(FormulaReferenceContract.isFormula("=#DIV/0!"))
        assertFalse(FormulaReferenceContract.isFormula("not a formula"))
        assertFalse(FormulaReferenceContract.isFormula("="))
        assertFalse(FormulaReferenceContract.isFormula("=SUM(1,)"))
        assertFalse(FormulaReferenceContract.isFormula("=TRUEish"))
    }

    @Test fun `canonicalizes ranges anchors canonical identities and qualified references`() {
        val content = TabularContent(columnCount = 2, rowCount = 2)
        val firstColumn = content.columns[0].value
        val secondColumn = content.columns[1].value
        val firstRow = content.rows[0].value
        val secondRow = content.rows[1].value
        val canonical = "=@$firstColumn[$firstRow]"
        val other = TabularContent(columnCount = 2, rowCount = 2)
        val (workbook, sheet, otherSheet) = workbook(content, other)

        assertEquals(
            "=@$firstColumn[$firstRow]:\$$secondColumn[\$$secondRow]",
            FormulaReferenceContract.canonicalize("=@A[1]:\$B[\$2]", workbook, sheet),
        )
        assertEquals(canonical, FormulaReferenceContract.canonicalize(canonical, workbook, sheet))
        assertEquals(
            "=@${otherSheet.value}!${other.columns[0].value}[${other.rows[0].value}] + @${otherSheet.value}!${other.columns[1].value}[${other.rows[1].value}]",
            FormulaReferenceContract.canonicalize("=@'Other sheet'!A[1] + @'Other sheet'!B[2]", workbook, sheet),
        )
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@A[3]", workbook, sheet))
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@C[1]", workbook, sheet))
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@#REF!A[1]", workbook, sheet))
        val escapedName = workbook.replaceSheet(workbook.findSheet(otherSheet)!!.rename("O'Brien"))
        assertEquals(
            "=@${otherSheet.value}!${other.columns[0].value}[${other.rows[0].value}]",
            FormulaReferenceContract.canonicalize("=@'O''Brien'!A[1]", escapedName, sheet),
        )
        assertNull(FormulaReferenceContract.canonicalize("plain text", workbook, sheet))
    }

    @Test fun `copies canonical formulas by row and column while respecting anchors`() {
        val content = TabularContent(columnCount = 3, rowCount = 3)
        val source = CellCoordinate(content.rows[0], content.columns[0])
        val destination = CellCoordinate(content.rows[1], content.columns[1])
        val firstColumn = content.columns[0].value
        val secondColumn = content.columns[1].value
        val thirdColumn = content.columns[2].value
        val firstRow = content.rows[0].value
        val secondRow = content.rows[1].value
        val thirdRow = content.rows[2].value

        val (workbook, sheet) = workbook(content)
        assertEquals(
            "=@$secondColumn[$secondRow] + @\$$firstColumn[$secondRow] + @$secondColumn[\$$firstRow] + @\$$firstColumn[\$$firstRow]",
            FormulaReferenceContract.copyCanonical(
                "=@$firstColumn[$firstRow] + @\$$firstColumn[$firstRow] + @$firstColumn[\$$firstRow] + @\$$firstColumn[\$$firstRow]",
                source,
                destination,
                workbook, sheet,
            ),
        )
        assertEquals(
            "=@$thirdColumn[$thirdRow]",
            FormulaReferenceContract.copyCanonical("=@$secondColumn[$secondRow]", source, destination, workbook, sheet),
        )
        assertEquals(
            "=@$secondColumn[$secondRow]",
            FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", source, destination, workbook, sheet),
        )
        assertEquals(
            "=@$thirdColumn[$thirdRow]",
            FormulaReferenceContract.copyCanonical("=@$secondColumn[$secondRow]", source, destination, workbook, sheet),
        )
        assertNull(FormulaReferenceContract.copyCanonical("=@$secondColumn[$thirdRow]", source, destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$thirdColumn[$thirdRow]", source, destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@missing-1[$firstRow]", source, destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[missing-1]", source, destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("plain text", source, destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", CellCoordinate(RowId("gone"), content.columns[0]), destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", CellCoordinate(content.rows[0], ColumnId("gone")), destination, workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", source, CellCoordinate(content.rows[1], ColumnId("gone")), workbook, sheet))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", source, CellCoordinate(RowId("gone"), content.columns[1]), workbook, sheet))
    }

    @Test fun `rejects mixed endpoint ranges and preserves explicit sheet during copy`() {
        val local = TabularContent(columnCount = 2, rowCount = 2)
        val target = TabularContent(columnCount = 2, rowCount = 2)
        val (workbook, sheet, targetSheet) = workbook(local, target)
        assertFalse(FormulaReferenceContract.isFormula("=@A[1]:${target.columns[0].value}[${target.rows[0].value}]"))
        val raw = "=@${targetSheet.value}!${target.columns[0].value}[${target.rows[0].value}]"
        val copied = FormulaReferenceContract.copyCanonical(raw, CellCoordinate(local.rows[0], local.columns[0]), CellCoordinate(local.rows[1], local.columns[1]), workbook, sheet)
        assertEquals("=@${targetSheet.value}!${target.columns[1].value}[${target.rows[1].value}]", copied)
    }

    @Test fun `resolves qualified targets by identifier and rejects unavailable copy sheets`() {
        val local = TabularContent(columnCount = 2, rowCount = 2)
        val target = TabularContent(columnCount = 2, rowCount = 2)
        val (workbook, sheet, targetSheet) = workbook(local, target)
        val source = CellCoordinate(local.rows[0], local.columns[0])
        val destination = CellCoordinate(local.rows[1], local.columns[1])

        assertEquals(
            "=@${targetSheet.value}!${target.columns[0].value}[${target.rows[0].value}]",
            FormulaReferenceContract.canonicalize("=@${targetSheet.value}!A[1]", workbook, sheet),
        )
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@missing-sheet!A[1]", workbook, sheet))
        assertNull(
            FormulaReferenceContract.copyCanonical(
                "=@${targetSheet.value}!${target.columns[0].value}[${target.rows[0].value}]",
                source, destination, workbook, sheet, sourceSheetId = SheetId("missing-source"),
            ),
        )
        assertNull(
            FormulaReferenceContract.copyCanonical(
                "=@${targetSheet.value}!${target.columns[0].value}[${target.rows[0].value}]",
                source, destination, workbook, sheet, destinationSheetId = SheetId("missing-destination"),
            ),
        )
        assertNull(
            FormulaReferenceContract.copyCanonical(
                "=@missing-sheet!${target.columns[0].value}[${target.rows[0].value}]",
                source, destination, workbook, sheet,
            ),
        )
    }

    @Test fun `rejects calculated ownership when its sheet is unavailable`() {
        val (workbook) = workbook(TabularContent(cells = mapOf("A1" to "value")))
        val model = DataModel(
            "model-1",
            "Metrics",
            listOf(CalculatedDataModelProperty("property-1", "Derived", "=@A[1]")),
        )

        assertFalse(hasOnlyModelOwnedCalculatedContents(workbook, SheetId("missing-sheet"), model))
    }

    private fun workbook(vararg contents: TabularContent): Triple<WorkbookState, SheetId, SheetId> {
        val ids = contents.indices.map { SheetId("sheet-$it") }
        val documents = contents.mapIndexed { index, content -> ids[index] to SheetDocument(ids[index], name = if (index == 1) "Other sheet" else "Local", content = content) }.toMap()
        return Triple(WorkbookState(WorkbookManifest(sheetIds = ids), documents), ids[0], ids.getOrElse(1) { ids[0] })
    }
}
