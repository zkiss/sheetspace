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
        assertEquals("=@${content.columns.first().value}[${content.rows.first().value}]*2", FormulaReferenceContract.canonicalize("=@A[1]*2", content))
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@Z[999]", content))
    }

    @Test fun `rejects incomplete syntax while preserving literal reference text`() {
        val content = TabularContent(cells = mapOf("A1" to "value"))
        assertTrue(!FormulaReferenceContract.isFormula("=1+"))
        assertEquals("=\"@A[1]\"", FormulaReferenceContract.canonicalize("=\"@A[1]\"", content))
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

        assertEquals(
            "=@$firstColumn[$firstRow]:\$$secondColumn[\$$secondRow]",
            FormulaReferenceContract.canonicalize("=@A[1]:\$B[\$2]", content),
        )
        assertEquals(canonical, FormulaReferenceContract.canonicalize(canonical, content))
        assertEquals(
            "=@'Sales Q1'!$firstColumn[$firstRow] + @Other!$secondColumn[$secondRow]",
            FormulaReferenceContract.canonicalize("=@'Sales Q1'!A[1] + @Other!B[2]", content),
        )
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@A[3]", content))
        assertEquals("=#REF!", FormulaReferenceContract.canonicalize("=@C[1]", content))
        assertNull(FormulaReferenceContract.canonicalize("plain text", content))
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

        assertEquals(
            "=@$secondColumn[$secondRow] + @\$$firstColumn[$secondRow] + @$secondColumn[\$$firstRow] + @\$$firstColumn[\$$firstRow]",
            FormulaReferenceContract.copyCanonical(
                "=@$firstColumn[$firstRow] + @\$$firstColumn[$firstRow] + @$firstColumn[\$$firstRow] + @\$$firstColumn[\$$firstRow]",
                source,
                destination,
                content,
            ),
        )
        assertEquals(
            "=@$thirdColumn[$thirdRow]",
            FormulaReferenceContract.copyCanonical("=@$secondColumn[$secondRow]", source, destination, content),
        )
        assertEquals(
            "=@$secondColumn[$secondRow]",
            FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", source, destination, content),
        )
        assertEquals(
            "=@$thirdColumn[$thirdRow]",
            FormulaReferenceContract.copyCanonical("=@$secondColumn[$secondRow]", source, destination, content),
        )
        assertEquals("=#REF!", FormulaReferenceContract.copyCanonical("=@$secondColumn[$thirdRow]", source, destination, content))
        assertEquals("=#REF!", FormulaReferenceContract.copyCanonical("=@$thirdColumn[$thirdRow]", source, destination, content))
        assertEquals("=#REF!", FormulaReferenceContract.copyCanonical("=@missing-1[$firstRow]", source, destination, content))
        assertEquals("=#REF!", FormulaReferenceContract.copyCanonical("=@$firstColumn[missing-1]", source, destination, content))
        assertNull(FormulaReferenceContract.copyCanonical("plain text", source, destination, content))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", CellCoordinate(RowId("gone"), content.columns[0]), destination, content))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", CellCoordinate(content.rows[0], ColumnId("gone")), destination, content))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", source, CellCoordinate(content.rows[1], ColumnId("gone")), content))
        assertNull(FormulaReferenceContract.copyCanonical("=@$firstColumn[$firstRow]", source, CellCoordinate(RowId("gone"), content.columns[1]), content))
    }
}
