package com.sheetspace

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class FormatWritePolicyTest {
    @Test
    fun `format policy supports valid scopes clearing and invalid number formats`() {
        val document = testDocument(TEST_SHEET_1, "Formats")
        val row = document.tabularContent.rows[0].value
        val column = document.tabularContent.columns[0].value
        val cell = "$row\u0000$column"
        val writes = listOf(FormatWrite("row", row, NumberFormat("general")), FormatWrite("column", column, NumberFormat("number", 0)), FormatWrite("cell", cell, NumberFormat("percent", 10)))
        val formatted = validatedFormatWrites(document, writes)

        assertEquals(writes.map { it.targetId }.toSet(), (formatted.formatOverrides.rows.keys + formatted.formatOverrides.columns.keys + formatted.formatOverrides.cells.keys).toSet())
        assertEquals(SheetPresentation(), validatedFormatWrites(document.copy(presentation = formatted), writes.map { it.copy(properties = mapOf("numberFormat" to JsonNull)) }))
        listOf(emptyList(), listOf(writes[0], writes[0].copy(numberFormat = null)), listOf(FormatWrite("row", "missing", null)), listOf(FormatWrite("cell", row, null)), listOf(FormatWrite("other", row, null)), listOf(FormatWrite("row", row, NumberFormat("general", 0))), listOf(FormatWrite("row", row, NumberFormat("number", null))), listOf(FormatWrite("row", row, NumberFormat("percent", 11))), listOf(FormatWrite("row", row, NumberFormat("currency", 2)))).forEach { invalid ->
            assertFailsWith<WorkbookApplicationException> { validatedFormatWrites(document, invalid) }
        }
    }

    @Test
    fun `appearance format policy composes properties and rejects malformed patches`() {
        val document = testDocument(TEST_SHEET_1, "Appearance")
        val row = document.tabularContent.rows[0].value
        val column = document.tabularContent.columns[0].value
        val cell = "$row\u0000$column"
        val properties = mapOf("numberFormat" to buildJsonObject { put("kind", "number"); put("precision", 2) }, "fontWeight" to JsonPrimitive("bold"), "horizontalAlignment" to JsonPrimitive("center"), "textColor" to JsonPrimitive("#123456"), "fillColor" to JsonPrimitive("#abcdef"))
        val styled = validatedFormatWrites(document, listOf(FormatWrite("cell", cell, properties = properties)))
        assertEquals(CellFormat(NumberFormat("number", 2), "bold", "center", "#123456", "#abcdef"), styled.formatOverrides.cells[cell])
        val retained = validatedFormatWrites(document.copy(presentation = styled), listOf(FormatWrite("cell", cell, properties = mapOf("numberFormat" to JsonNull, "textColor" to JsonNull))))
        assertEquals(CellFormat(fontWeight = "bold", horizontalAlignment = "center", fillColor = "#abcdef"), retained.formatOverrides.cells[cell])
        assertEquals(SheetPresentation(), validatedFormatWrites(document.copy(presentation = retained), listOf(FormatWrite("cell", cell, properties = mapOf("fontWeight" to JsonNull, "horizontalAlignment" to JsonNull, "fillColor" to JsonNull)))))
        listOf(emptyMap(), mapOf("numberFormat" to buildJsonObject { put("kind", "general"); put("precision", 0) }), mapOf("numberFormat" to buildJsonObject { put("kind", "number") }), mapOf("numberFormat" to JsonPrimitive("number")), mapOf("numberFormat" to buildJsonObject {}), mapOf("numberFormat" to buildJsonObject { put("kind", buildJsonObject {}) }), mapOf("numberFormat" to buildJsonObject { put("kind", "number"); put("precision", buildJsonObject {}) }), mapOf("numberFormat" to buildJsonObject { put("kind", "number"); put("precision", "2") }), mapOf("numberFormat" to buildJsonObject { put("kind", "number"); put("precision", -1) }), mapOf("numberFormat" to buildJsonObject { put("kind", "percent"); put("precision", 11) }), mapOf("fontWeight" to JsonPrimitive("heavy")), mapOf("horizontalAlignment" to JsonPrimitive("justify")), mapOf("textColor" to JsonPrimitive("#12345")), mapOf("fillColor" to JsonPrimitive("transparent")), mapOf("unknown" to JsonPrimitive("value"))).forEach { invalid ->
            assertFailsWith<WorkbookApplicationException> { validatedFormatWrites(document, listOf(FormatWrite("row", row, properties = invalid))) }
        }
    }

    @Test
    fun `format policy preserves automatic colours and rejects imprecise general format`() {
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        val row = sheet.tabularContent.rows.first().value

        val updated = validatedFormatWrites(sheet, listOf(FormatWrite("row", row, properties = mapOf("textColor" to JsonPrimitive("automatic"), "fillColor" to JsonPrimitive("none")))))

        assertEquals(CellFormat(textColor = "automatic", fillColor = "none"), updated.formatOverrides.rows[row])
        assertFailsWith<WorkbookApplicationException> { validatedFormatWrites(sheet, listOf(FormatWrite("row", row, NumberFormat("general", 2)))) }
    }
}
