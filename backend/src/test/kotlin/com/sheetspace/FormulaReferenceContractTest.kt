package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
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
}
