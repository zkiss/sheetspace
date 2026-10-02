package com.sheetspace

import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

class SheetPresentationSerializationTest {
    private val json = Json { encodeDefaults = true }

    @Test
    fun `optional appearance fields and general precision are omitted even with defaults enabled`() {
        val general = CellFormat(numberFormat = NumberFormat("general"))
        assertEquals("""{"numberFormat":{"kind":"general"}}""", json.encodeToString(general))
        assertEquals("{}", json.encodeToString(CellFormat()))
        assertEquals(general, json.decodeFromString<CellFormat>(json.encodeToString(general)))
    }

    @Test
    fun `explicit defaults precision and colours survive a fresh serialization round trip`() {
        val appearance = CellFormat(
            numberFormat = NumberFormat("percent", 0), fontWeight = "normal",
            horizontalAlignment = "general", textColor = "automatic", fillColor = "none",
        )
        val presentation = SheetPresentation(formatOverrides = SheetFormatOverrides(cells = mapOf("row\u0000column" to appearance)))
        val encoded = json.encodeToString(presentation)
        assertEquals(presentation, json.decodeFromString<SheetPresentation>(encoded))
        assertEquals(setOf("numberFormat", "fontWeight", "horizontalAlignment", "textColor", "fillColor"), json.parseToJsonElement(json.encodeToString(appearance)).jsonObject.keys)
        val sparse = CellFormat(textColor = "#123456", fillColor = "#abcdef")
        assertEquals("""{"textColor":"#123456","fillColor":"#abcdef"}""", json.encodeToString(sparse))
        assertEquals(sparse, json.decodeFromString<CellFormat>(json.encodeToString(sparse)))
    }
}
