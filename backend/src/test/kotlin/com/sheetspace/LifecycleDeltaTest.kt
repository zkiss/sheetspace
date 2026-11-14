package com.sheetspace

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class LifecycleDeltaTest {
    private fun json(value: String) = Json.parseToJsonElement(value)

    @Test
    fun `replay preserves independent nested changes and changes only captured fields`() {
        val expected = json("""{"sheet":{"name":"old","frame":1},"extra":0}""")
        val target = json("""{"sheet":{"name":"new","frame":1},"added":true}""")
        val current = json("""{"sheet":{"name":"old","frame":2},"extra":0,"other":3}""")

        assertEquals(json("""{"sheet":{"name":"new","frame":2},"added":true,"other":3}"""), replayLifecycleDelta(current, expected, target))
    }

    @Test
    fun `replay rejects changes overlapping the captured transition`() {
        val expected = json("""{"sheet":{"name":"old"}}""")
        val target = json("""{"sheet":{"name":"new"}}""")
        val current = json("""{"sheet":{"name":"different"}}""")

        assertFailsWith<WorkbookApplicationException> { replayLifecycleDelta(current, expected, target) }
        assertFailsWith<WorkbookApplicationException> { replayLifecycleDelta(json("""{"sheet":null}"""), expected, target) }
    }

    @Test
    fun `replay guards entire arrays and identity additions`() {
        val expected = json("""{"ids":[1,2]}""")
        val target = json("""{"ids":[1,2,3],"sheet":{"id":3}}""")

        assertEquals(target, replayLifecycleDelta(expected, expected, target))
        assertFailsWith<WorkbookApplicationException> { replayLifecycleDelta(json("""{"ids":[2,1]}"""), expected, target) }
        assertFailsWith<WorkbookApplicationException> { replayLifecycleDelta(json("""{"ids":[1,2],"sheet":{"id":4}}"""), expected, target) }
    }
}
