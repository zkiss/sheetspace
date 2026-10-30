package com.sheetspace

import kotlinx.serialization.json.Json
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
    fun `shared inline fixtures decode opaque text without changing content`() {
        fixtures.getValue("valid").jsonArray.forEach { fixture ->
            val example = fixture.jsonObject
            val content = example.getValue("content").jsonPrimitive.content
            val fragments = example.getValue("fragments").jsonArray.map { it.jsonPrimitive.content }
            assertEquals(content, StoredFormulaCodec.require(content))
            assertEquals(fragments, StoredFormulaCodec.opaqueText(content).map { it.text })
            fragments.forEach { fragment ->
                assertEquals(fragment, StoredFormulaCodec.opaqueText("=" + StoredFormulaCodec.escape(fragment)).single().text)
            }
        }
    }

    @Test
    fun `shared malformed inline fixtures are rejected`() {
        fixtures.getValue("invalid").jsonArray.forEach { content ->
            assertFailsWith<IllegalArgumentException>(content.jsonPrimitive.content) {
                StoredFormulaCodec.require(content.jsonPrimitive.content)
            }
        }
    }
}
