package com.sheetspace

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PreparedModelFormulaTest {
    @Test
    fun `single content model transport instantiates shared fixtures without interpreting expression text`() {
        val fixtures = Json.parseToJsonElement(requireNotNull(javaClass.getResource("/stored-model-instances.json")).readText()).jsonArray
        fixtures.forEach { element ->
            val fixture = element.jsonObject
            val template = PreparedModelFormula(fixture.getValue("template").jsonPrimitive.content)
            val transport = Json.encodeToString(template)
            val restored = Json.decodeFromString<PreparedModelFormula>(transport)
            val rows = fixture.getValue("rows").let { value ->
                if (value is JsonNull) null else value.jsonArray.map { RowId(it.jsonPrimitive.content) }
            }
            val workbook = if (rows == null) emptyWorkbookState() else emptyWorkbookState().addSheet(SheetDocument(
                SheetId("sheet"), name = "Inputs", content = TabularContent(rows, listOf(ColumnId("col1"), ColumnId("col2")), emptyMap()),
            ))

            assertEquals(setOf("content"), Json.parseToJsonElement(transport).jsonObject.keys)
            assertEquals(template, restored)
            val declaration = fixture.getValue("declaration").jsonPrimitive.content
            assertTrue(preparedModelTemplateIsValid(restored, declaration))
            assertEquals(fixture.getValue("expected").jsonPrimitive.content, derivedPreparedFormulaRaw(restored, workbook, fixture.getValue("rowIndex").jsonPrimitive.int, declaration, "sheet"))
        }
    }

    @Test
    fun `declaration association rejects malformed encoding and changed expression`() {
        val content = "=" + StoredFormulaCodec.escape("@Missing!A[1]") + "+???"

        assertTrue(preparedModelTemplateIsValid(PreparedModelFormula(content), "=@Missing!A[1]+???"))
        assertFalse(preparedModelTemplateIsValid(PreparedModelFormula(content), "=@Missing!A[1]+3"))
        assertFalse(preparedModelTemplateIsValid(PreparedModelFormula("=~{xyz}"), "=1"))
    }
}
