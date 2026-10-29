package com.sheetspace

import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StoredModelFormulaInstanceTest {
    private val formula = StoredFormula(
        "=@A[1]:B[2]+???",
        listOf(FormulaOccurrence(
            "o", FormulaSpan(1, 11), "s",
            listOf(FormulaEndpoint("e1", "c1", "r1", false, false), FormulaEndpoint("e2", "c2", "r2", false, true)),
            listOf(
                FormulaSlot("s", "sheet", JsonPrimitive("Inputs"), "retained", listOf("sheet")),
                FormulaSlot("c1", "column", JsonPrimitive(0), "retained", listOf("col1")),
                FormulaSlot("r1", "row", JsonPrimitive(1), "retained", listOf("row1")),
                FormulaSlot("c2", "column", JsonPrimitive(1), "retained", listOf("col2")),
                FormulaSlot("r2", "row", JsonPrimitive(2), "retained", listOf("row2")),
            ), emptyList(),
        )),
    )

    @Test
    fun `relative and anchored endpoints use independent row recipes without changing text`() {
        val result = instantiateStoredModelFormula(StoredFormulaCodec.encode(formula), 1) { listOf("row1", "row2", "row3") }
        val instance = StoredFormulaCodec.decode(result)
        assertEquals(formula.text, instance.text)
        assertEquals(listOf(listOf("row2"), listOf("row2")), instance.occurrences.single().slots.filter { it.kind == "row" }.map { it.targetIds })
    }

    @Test
    fun `unavailable row becomes unresolved while missing sheet retains its identities`() {
        val content = StoredFormulaCodec.encode(formula)
        val instance = StoredFormulaCodec.decode(instantiateStoredModelFormula(content, 3) { listOf("row1", "row2") })
        assertEquals("unresolved", instance.occurrences.single().slots.first { it.id == "r1" }.status)
        assertEquals(content, instantiateStoredModelFormula(content, 3) { null })
    }

    @Test
    fun `instance structure permits instantiated row identities but rejects other changes`() {
        val template = StoredFormulaCodec.encode(formula)
        val instance = instantiateStoredModelFormula(template, 1) { listOf("row1", "row2", "row3") }
        assertTrue(storedModelInstanceMatchesTemplate(template, instance))
        val changed = formula.copy(text = "=@A[1]:B[2]+BAD")
        assertFalse(storedModelInstanceMatchesTemplate(template, StoredFormulaCodec.encode(changed)))
        assertFalse(storedModelInstanceMatchesTemplate(template, "not a formula"))
        val occurrence = formula.occurrences.single()
        val slots = occurrence.slots.map { if (it.id == "c1") it.copy(targetIds = listOf("forged")) else it }
        val forged = formula.copy(occurrences = listOf(occurrence.copy(slots = slots)))
        assertFalse(storedModelInstanceMatchesTemplate(template, StoredFormulaCodec.encode(forged)))
    }
}
