package com.sheetspace

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.int
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StoredModelFormulaInstanceTest {
    @Test
    fun `shared encoded instances match frontend bytes`() {
        val fixtures = Json.parseToJsonElement(requireNotNull(javaClass.getResource("/stored-model-instances.json")).readText()).jsonArray
        fixtures.forEach { element ->
            val fixture = element.jsonObject
            val rows = fixture.getValue("rows").let { value ->
                if (value is JsonNull) null else value.jsonArray.map { it.jsonPrimitive.content }
            }
            val actual = instantiateStoredModelFormula(fixture.getValue("template").jsonPrimitive.content, fixture.getValue("rowIndex").jsonPrimitive.int) { rows }
            assertEquals(fixture.getValue("expected").jsonPrimitive.content, actual, fixture.getValue("name").jsonPrimitive.content)
        }
    }

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
        assertFalse(storedModelInstanceMatchesTemplate(template, StoredFormulaCodec.encode(formula.copy(occurrences = emptyList()))))
    }

    @Test
    fun `unresolved sheet and dormant row payloads are not manufactured into new bindings`() {
        val occurrence = formula.occurrences.single()
        val unresolved = formula.copy(occurrences = listOf(occurrence.copy(slots = occurrence.slots.map {
            if (it.id == "s") it.copy(status = "unresolved", targetIds = emptyList()) else it
        })))
        val unresolvedContent = StoredFormulaCodec.encode(unresolved)
        assertEquals(unresolvedContent, instantiateStoredModelFormula(unresolvedContent, 1) { error("An unresolved parent must not be looked up") })
        val dormant = formula.copy(occurrences = listOf(occurrence.copy(slots = occurrence.slots.map {
            if (it.id == "r1") it.copy(key = JsonNull) else it
        })))
        val instance = StoredFormulaCodec.decode(instantiateStoredModelFormula(StoredFormulaCodec.encode(dormant), 1) { listOf("new-row1", "new-row2") })
        assertEquals(dormant.occurrences.single().slots.first { it.id == "r1" }, instance.occurrences.single().slots.first { it.id == "r1" })
        assertEquals(listOf("new-row2"), instance.occurrences.single().slots.first { it.id == "r2" }.targetIds)
    }
}
