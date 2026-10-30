package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class InlineFormulaReferencesTest {
    @Test
    fun `declaration scanner preserves qualifier anchors and range recipes`() {
        val references = inlineFormulaReferences("=SUM(@'Owner''s sheet'!\$A[2] : B[\$3], @Revenue)", false)

        assertEquals(2, references.size)
        assertEquals("Owner's sheet", references[0].qualifier)
        assertEquals(listOf("A", "B"), references[0].endpoints.map { it.column })
        assertEquals(listOf("2", "3"), references[0].endpoints.map { it.row })
        assertTrue(references[0].endpoints[0].columnAnchor)
        assertTrue(references[0].endpoints[1].rowAnchor)
        assertEquals("Revenue", references[1].endpoints.single().property)
        assertEquals("1", references[1].endpoints.single().row)
    }

    @Test
    fun `scanner ignores quoted and opaque references but recovers later references`() {
        val opaque = StoredFormulaCodec.escape("@hidden!col:1[row:1]")
        val text = "=\"quoted \"\"@ignored\"\"\"+$opaque+@sheet:1!col:1[row:1]"

        val references = inlineFormulaReferences(text, true)

        assertEquals(1, references.size)
        assertEquals("sheet:1", references.single().qualifier)
        assertEquals("col:1", references.single().endpoints.single().column)
        assertEquals("row:1", references.single().endpoints.single().row)
    }

    @Test
    fun `stored scanner decodes property identities and rejects malformed endpoint shapes`() {
        val references = inlineFormulaReferences("=@~0069~0063[0072]:~006a~0064[0073]", true)

        assertEquals(listOf("i", "j"), references.single().endpoints.map { it.property })
        assertEquals(listOf("c", "d"), references.single().endpoints.map { it.column })
        assertEquals(listOf("r", "s"), references.single().endpoints.map { it.row })
        for (text in listOf("=@~1~0063[0072]", "=@~0069~1[0072]", "=@~0069~0063[1]", "=@A[row:1]", "=@col:1[row:1]:~0069~0063[0072]", "=@col:1[row:1]:")) {
            assertTrue(inlineFormulaReferences(text, true).isEmpty(), text)
        }
    }

    @Test
    fun `declaration scanner rejects invalid ranges and unsafe numeric rows`() {
        for (text in listOf("=@A[1]:", "=@A[9007199254740992]", "=@A[999999999999999999999999]")) {
            assertTrue(inlineFormulaReferences(text, false).isEmpty(), text)
        }
        assertEquals("9007199254740991", inlineFormulaReferences("=@A[9007199254740991]", false).single().endpoints.single().row)
    }

    @Test
    fun `scanner does not consume later qualifier or endpoint as part of malformed reference`() {
        assertEquals("Later", inlineFormulaReferences("=@? @Later!A[1]", false).single().qualifier)
    }
}
