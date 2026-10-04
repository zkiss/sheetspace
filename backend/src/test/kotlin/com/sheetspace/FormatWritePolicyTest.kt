package com.sheetspace

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class FormatWritePolicyTest {
    @Test fun `format writes support row column and cell scopes`() {
        val fixture = fixture(); val writes = listOf(FormatWrite("row", fixture.row, NumberFormat("general")), FormatWrite("column", fixture.column, NumberFormat("number", 0)), FormatWrite("cell", fixture.cell, NumberFormat("percent", 10)))
        val formatted = validatedFormatWrites(fixture.sheet, writes)
        assertEquals(writes.map { it.targetId }.toSet(), (formatted.formatOverrides.rows.keys + formatted.formatOverrides.columns.keys + formatted.formatOverrides.cells.keys).toSet())
    }

    @Test fun `format writes clear an existing number format`() {
        val fixture = fixture(); val formatted = validatedFormatWrites(fixture.sheet, listOf(FormatWrite("row", fixture.row, NumberFormat("general"))))
        assertEquals(SheetPresentation(), validatedFormatWrites(fixture.sheet.copy(presentation = formatted), listOf(FormatWrite("row", fixture.row, properties = mapOf("numberFormat" to JsonNull)))))
    }

    @Test
    fun `format writes reject an empty patch`() = assertRejected(emptyList())
    @Test
    fun `format writes reject duplicate targets`() = fixture().let { assertRejected(it, listOf(FormatWrite("row", it.row, null), FormatWrite("row", it.row, null))) }
    @Test
    fun `format writes reject a missing row target`() = fixture().let { assertRejected(it, listOf(FormatWrite("row", "missing", null))) }
    @Test
    fun `format writes reject a missing column in a cell target`() = fixture().let { assertRejected(it, listOf(FormatWrite("cell", "${it.row}\u0000missing", null))) }
    @Test
    fun `format writes reject a malformed cell target`() = fixture().let { assertRejected(it, listOf(FormatWrite("cell", it.row, null))) }
    @Test
    fun `format writes reject an unknown scope`() = fixture().let { assertRejected(it, listOf(FormatWrite("other", it.row, null))) }
    @Test
    fun `general format rejects precision`() = fixture().let { assertRejected(it, listOf(FormatWrite("row", it.row, NumberFormat("general", 0)))) }
    @Test
    fun `number format requires precision`() = fixture().let { assertRejected(it, listOf(FormatWrite("row", it.row, NumberFormat("number", null)))) }
    @Test
    fun `percent format caps precision`() = fixture().let { assertRejected(it, listOf(FormatWrite("row", it.row, NumberFormat("percent", 11)))) }
    @Test
    fun `format kind must be supported`() = fixture().let { assertRejected(it, listOf(FormatWrite("row", it.row, NumberFormat("currency", 2)))) }

    @Test fun `appearance properties compose independently`() {
        val properties = mapOf("numberFormat" to buildJsonObject { put("kind", "number"); put("precision", 2) }, "fontWeight" to JsonPrimitive("bold"), "horizontalAlignment" to JsonPrimitive("center"), "textColor" to JsonPrimitive("#123456"), "fillColor" to JsonPrimitive("#abcdef"))
        val fixture = fixture(); val styled = validatedFormatWrites(fixture.sheet, listOf(FormatWrite("cell", fixture.cell, properties = properties)))
        assertEquals(CellFormat(NumberFormat("number", 2), "bold", "center", "#123456", "#abcdef"), styled.formatOverrides.cells[fixture.cell])
    }

    @Test
    fun `appearance properties reject an empty patch`() = assertPropertiesRejected(emptyMap())
    @Test
    fun `appearance properties reject a string number format`() = assertPropertiesRejected(mapOf("numberFormat" to JsonPrimitive("number")))
    @Test
    fun `appearance properties reject string precision`() = assertPropertiesRejected(mapOf("numberFormat" to buildJsonObject { put("kind", "number"); put("precision", "2") }))
    @Test
    fun `appearance properties reject an invalid font weight`() = assertPropertiesRejected(mapOf("fontWeight" to JsonPrimitive("heavy")))
    @Test
    fun `appearance properties reject an invalid alignment`() = assertPropertiesRejected(mapOf("horizontalAlignment" to JsonPrimitive("justify")))
    @Test
    fun `appearance properties reject an invalid text colour`() = assertPropertiesRejected(mapOf("textColor" to JsonPrimitive("#12345")))
    @Test
    fun `appearance properties reject an unknown property`() = assertPropertiesRejected(mapOf("unknown" to JsonPrimitive("value")))
    @Test
    fun `appearance properties reject general precision`() = assertPropertiesRejected(mapOf("numberFormat" to buildJsonObject { put("kind", "general"); put("precision", 0) }))
    @Test
    fun `appearance properties reject missing number precision`() = assertPropertiesRejected(mapOf("numberFormat" to buildJsonObject { put("kind", "number") }))
    @Test
    fun `appearance properties reject an empty number format`() = assertPropertiesRejected(mapOf("numberFormat" to buildJsonObject {}))
    @Test
    fun `appearance properties reject a non-string number kind`() = assertPropertiesRejected(mapOf("numberFormat" to buildJsonObject { put("kind", buildJsonObject {}) }))
    @Test
    fun `appearance properties reject a non-number precision`() = assertPropertiesRejected(mapOf("numberFormat" to buildJsonObject { put("kind", "number"); put("precision", buildJsonObject {}) }))
    @Test
    fun `appearance properties reject negative precision`() = assertPropertiesRejected(mapOf("numberFormat" to buildJsonObject { put("kind", "number"); put("precision", -1) }))
    @Test
    fun `appearance properties reject excessive percent precision`() = assertPropertiesRejected(mapOf("numberFormat" to buildJsonObject { put("kind", "percent"); put("precision", 11) }))
    @Test
    fun `appearance properties reject an invalid fill colour`() = assertPropertiesRejected(mapOf("fillColor" to JsonPrimitive("transparent")))

    private fun assertRejected(writes: List<FormatWrite>): Unit = assertRejected(fixture(), writes)
    private fun assertRejected(fixture: FormatFixture, writes: List<FormatWrite>): Unit { assertFailsWith<WorkbookApplicationException> { validatedFormatWrites(fixture.sheet, writes) } }
    private fun assertPropertiesRejected(properties: Map<String, kotlinx.serialization.json.JsonElement>): Unit = fixture().let { assertRejected(it, listOf(FormatWrite("row", it.row, properties = properties))) }
    private fun fixture(): FormatFixture {
        val sheet = testDocument(TEST_SHEET_1, "Formats")
        val row = sheet.tabularContent.rows.first().value; val column = sheet.tabularContent.columns.first().value
        return FormatFixture(sheet, row, column, "$row\u0000$column")
    }
    private data class FormatFixture(val sheet: SheetDocument, val row: String, val column: String, val cell: String)
}
