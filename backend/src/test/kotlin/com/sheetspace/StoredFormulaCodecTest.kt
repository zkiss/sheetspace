package com.sheetspace

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class StoredFormulaCodecTest {
    private val fixtures = Json.parseToJsonElement(
        requireNotNull(javaClass.getResource("/stored-formula-contract.json")).readText(),
    ).jsonObject

    @Test
    fun `shared fixtures round trip with exact frontend bytes`() {
        fixtures.getValue("valid").jsonArray.forEach { fixture ->
            val example = fixture.jsonObject
            val content = example.getValue("content").jsonPrimitive.content
            val formula = StoredFormulaCodec.decode(content)
            assertEquals(example.getValue("text").jsonPrimitive.content, formula.text)
            assertEquals(content, StoredFormulaCodec.encode(formula), example.getValue("name").jsonPrimitive.content)
        }
    }

    @Test
    fun `invalid shared content fails instead of becoming literal text`() {
        fixtures.getValue("invalid").jsonArray.forEach { content -> assertInvalid(content.jsonPrimitive.content) }
    }

    @Test
    fun `dead identities and malformed dormant guards are retained without a workbook`() {
        val formula = boundFormula()
        assertEquals(listOf("sheet-dead"), formula.occurrences[0].slots[0].targetIds)
        assertEquals(JsonPrimitive(1), formula.occurrences[1].slots[2].key)
        assertEquals(listOf("row2-dead"), formula.occurrences[1].slots[2].targetIds)
        assertEquals("=@Old!A[1]+@Missing!B[0]", formula.text)
    }

    @Test
    fun `invalid in memory numbers fail before serialization can truncate them`() {
        listOf(JsonPrimitive(1.5), JsonPrimitive(Double.NaN), JsonPrimitive(Double.POSITIVE_INFINITY)).forEach { key ->
            val formula = boundFormula()
            val first = formula.occurrences.first()
            val invalidSlot = first.slots[1].copy(key = key)
            val invalid = formula.copy(occurrences = listOf(first.copy(slots = listOf(first.slots[0], invalidSlot, first.slots[2]))))
            assertFailsWith<IllegalArgumentException> { StoredFormulaCodec.encode(invalid) }
        }
    }

    @Test
    fun `range endpoint order and independent anchors survive serialization`() {
        val formula = boundFormula()
        val first = formula.occurrences.first()
        val range = first.copy(
            slots = first.slots + listOf(
                FormulaSlot("c2", "column", JsonPrimitive(1), "unresolved", emptyList()),
                FormulaSlot("r2", "row", JsonPrimitive(2), "unresolved", emptyList()),
            ),
            endpoints = first.endpoints + FormulaEndpoint("e2", "c2", "r2", true, false),
        )
        val updated = formula.copy(occurrences = listOf(range))
        assertEquals(updated, StoredFormulaCodec.decode(StoredFormulaCodec.encode(updated)))
    }

    @Test
    fun `metadata validates tuple shapes slot ownership keys and UTF16 bounds`() {
        invalidChanges().forEach { (path, replacement) ->
            val payload = Json.parseToJsonElement(boundContent().substring(4))
            assertInvalid("=~F1" + replace(payload, path, replacement))
        }
    }

    @Test
    fun `lone surrogates at identifier boundaries survive deterministic JSON escaping`() {
        listOf("\ud800", "\udc00", "\u001c").forEach { id ->
            val formula = boundFormula()
            val first = formula.occurrences.first()
            val sheet = first.slots.first().copy(targetIds = listOf(id))
            val updated = formula.copy(text = formula.text + "\ud800", occurrences = listOf(first.copy(slots = listOf(sheet) + first.slots.drop(1))))
            assertEquals(updated, StoredFormulaCodec.decode(StoredFormulaCodec.encode(updated)))
        }
    }

    @Test
    fun `numeric JSON spellings normalize to integer semantic keys`() {
        val input = boundContent().replace(",0,\"retained\"", ",0.0,\"retained\"")
        assertEquals(boundFormula(), StoredFormulaCodec.decode(input))
        assertEquals(boundContent(), StoredFormulaCodec.encode(StoredFormulaCodec.decode(input)))
    }

    @Test
    fun `different endpoints cannot share a row slot`() {
        val formula = boundFormula()
        val first = formula.occurrences.first()
        val aliased = first.copy(
            endpoints = first.endpoints + FormulaEndpoint("e2", "c2", "r", false, false),
            slots = first.slots + FormulaSlot("c2", "column", JsonPrimitive(1), "unresolved", emptyList()),
        )
        assertFailsWith<IllegalArgumentException> { StoredFormulaCodec.encode(formula.copy(occurrences = listOf(aliased))) }
    }

    private fun invalidChanges(): List<Pair<List<Int>, JsonElement>> = listOf(
        listOf(1, 0) to JsonNull,
        listOf(1, 0, 0) to JsonPrimitive(" "),
        listOf(1, 0, 0) to JsonPrimitive(1),
        listOf(1, 0, 0) to JsonArray(emptyList()),
        listOf(1, 0, 0) to JsonPrimitive("\ufeff"),
        listOf(1, 0, 1, 0) to JsonPrimitive(-1),
        listOf(1, 0, 1, 0) to JsonPrimitive(0.5),
        listOf(1, 0, 1, 0) to JsonPrimitive("1"),
        listOf(1, 0, 1, 0) to JsonNull,
        listOf(1, 0, 1, 0) to JsonArray(emptyList()),
        listOf(1, 0, 1, 0) to JsonPrimitive(Double.POSITIVE_INFINITY),
        listOf(1, 0, 1, 0) to JsonPrimitive(2147483648),
        listOf(1, 0, 1, 1) to JsonPrimitive(1),
        listOf(1, 1, 1, 1) to JsonPrimitive(25),
        listOf(1, 1, 1, 0) to JsonPrimitive(9),
        listOf(1, 1, 0) to JsonPrimitive("x"),
        listOf(1, 0, 2) to JsonPrimitive("missing"),
        listOf(1, 0, 2) to JsonPrimitive("c"),
        listOf(1, 0, 3, 0, 3) to JsonPrimitive("true"),
        listOf(1, 0, 3, 0, 3) to JsonArray(emptyList()),
        listOf(1, 0, 3, 0, 4) to JsonNull,
        listOf(1, 0, 3, 0, 1) to JsonPrimitive("r"),
        listOf(1, 0, 3, 0, 1) to JsonPrimitive("missing"),
        listOf(1, 0, 3, 0, 2) to JsonPrimitive("c"),
        listOf(1, 0, 4, 1, 0) to JsonPrimitive("s"),
        listOf(1, 0, 4, 0, 1) to JsonPrimitive("expression"),
        listOf(1, 0, 4, 0, 3) to JsonPrimitive("fresh"),
        listOf(1, 0, 4, 0, 2) to JsonPrimitive(1),
        listOf(1, 0, 4, 0) to Json.parseToJsonElement("[\"s\",\"property\",\"Name\",\"retained\",[\"property\"]]"),
        listOf(1, 0, 4, 1, 2) to JsonPrimitive(-1),
        listOf(1, 0, 4, 1, 2) to JsonPrimitive(1.5),
        listOf(1, 0, 4, 2, 2) to JsonPrimitive("1"),
        listOf(1, 0, 4, 2, 2) to JsonPrimitive(true),
        listOf(1, 0, 4, 2, 2) to JsonArray(emptyList()),
        listOf(1, 0, 4, 2, 2) to JsonPrimitive(0),
        listOf(1, 0, 4, 2, 2) to JsonPrimitive(9007199254740992),
        listOf(1, 0, 4, 0, 4) to JsonArray(emptyList()),
        listOf(1, 0, 4, 0, 3) to JsonPrimitive("unresolved"),
        listOf(1, 0, 4, 0, 4, 0) to JsonPrimitive(""),
        listOf(1, 0, 5, 0, 2) to JsonPrimitive("absent"),
        listOf(1, 0, 5, 0, 0) to JsonPrimitive(0),
        listOf(1, 0, 5, 6, 1) to JsonPrimitive(11),
        listOf(1, 0, 5, 0, 0) to JsonPrimitive(3),
        listOf(1, 0, 5, 1, 0) to JsonPrimitive(1),
        listOf(1, 0, 3) to Json.parseToJsonElement("[[\"e\",\"c\",\"r\",false,false],[\"e\",\"c\",\"r\",false,false]]"),
        listOf(1, 0, 3) to Json.parseToJsonElement("[[\"e\",\"c\",\"r\",false,false],[\"e2\",\"c\",\"r\",false,false]]"),
        listOf(1, 0, 3) to Json.parseToJsonElement("[[\"e\",\"c\",\"r\",false,false],[\"e2\",\"c\",\"r\",false,false],[\"e3\",\"c\",\"r\",false,false]]"),
        listOf(1, 0, 4) to Json.parseToJsonElement("[[\"s\",\"sheet\",\"Old\",\"retained\",[\"sheet\"]],[\"c\",\"column\",0,\"retained\",[\"column\"]],[\"r\",\"row\",1,\"retained\",[\"row\"]],[\"p\",\"property\",3,\"retained\",[\"property\",\"column\"]]]"),
        listOf(1, 0, 5) to Json.parseToJsonElement("[[1,1,null],[1,1,null]]"),
        listOf(1, 0, 5) to Json.parseToJsonElement("[[1,1,\"s\"],[1,1,\"r\"]]"),
    )

    private fun replace(element: JsonElement, path: List<Int>, replacement: JsonElement): JsonElement {
        if (path.isEmpty()) return replacement
        return JsonArray(element.jsonArray.mapIndexed { index, child ->
            if (index == path.first()) replace(child, path.drop(1), replacement) else child
        })
    }

    private fun boundContent(): String = fixtures.getValue("valid").jsonArray[4].jsonObject.getValue("content").jsonPrimitive.content
    private fun boundFormula(): StoredFormula = StoredFormulaCodec.decode(boundContent())
    private fun assertInvalid(content: String) {
        assertFailsWith<IllegalArgumentException>(content) { StoredFormulaCodec.decode(content) }
    }
}
