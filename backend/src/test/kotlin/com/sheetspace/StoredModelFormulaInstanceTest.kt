package com.sheetspace

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class StoredModelFormulaInstanceTest {
    @Test
    fun `shared inline instances match frontend bytes`() {
        val fixtures = Json.parseToJsonElement(requireNotNull(javaClass.getResource("/stored-model-instances.json")).readText()).jsonArray
        fixtures.forEach { element ->
            val fixture = element.jsonObject
            val rows = fixture.getValue("rows").let { value ->
                if (value is JsonNull) null else value.jsonArray.map { it.jsonPrimitive.content }
            }
            val actual = instantiateStoredModelFormula(
                fixture.getValue("template").jsonPrimitive.content,
                fixture.getValue("declaration").jsonPrimitive.content,
                "sheet",
                fixture.getValue("rowIndex").jsonPrimitive.int,
            ) { rows }
            assertEquals(fixture.getValue("expected").jsonPrimitive.content, actual, fixture.getValue("name").jsonPrimitive.content)
        }
    }

    @Test
    fun `opaque references remain unbound during instantiation`() {
        val declaration = "=@Missing!A[1]+@A[1]"
        val opaque = StoredFormulaCodec.escape("@Missing!A[1]")
        val template = "=$opaque+@col1[r1]"
        assertEquals("=$opaque+@col1[r2]", instantiateStoredModelFormula(template, declaration, "sheet", 1) { listOf("r1", "r2") })
    }

    @Test
    fun `association identifies opaque and canonical spans without rebinding`() {
        val declaration = "=2+@Missing!A[1]+@A[1]"
        val opaque = StoredFormulaCodec.escape("@Missing!A[1]")
        val template = "=2+$opaque+@col1[r1]"
        val associations = requireNotNull(modelFormulaAssociations(template, declaration))
        assertEquals(2, associations.size)
        assertNull(associations[0].stored)
        assertEquals(opaque, template.substring(associations[0].start, associations[0].end))
        assertEquals("@col1[r1]", template.substring(associations[1].start, associations[1].end))
        assertEquals(1, requireNotNull(modelFormulaRecipes(template, declaration)).size)
    }

    @Test
    fun `association aligns separately encoded expression gaps and references`() {
        val declaration = "=2+@Missing[1]+3"
        val opaque = StoredFormulaCodec.escape("@Missing[1]")
        val template = "=" + StoredFormulaCodec.escape("2+") + opaque + "+3"
        val associations = requireNotNull(modelFormulaAssociations(template, declaration))

        assertEquals(1, associations.size)
        assertNull(associations.single().stored)
        assertEquals(opaque, template.substring(associations.single().start, associations.single().end))
        assertEquals(emptyList(), modelFormulaRecipes(template, declaration))
        assertNull(modelFormulaAssociations("=" + StoredFormulaCodec.escape("2+@Missing[1]") + "+3", declaration))
    }

    @Test
    fun `projection edits opaque references without changing canonical tokens or literals`() {
        val declaration = "=@Old[1]+@Old[1]:Missing[1]+\"Old\""
        val opaque = StoredFormulaCodec.escape("@Old[1]:Missing[1]")
        val template = "=@col1[r1]+$opaque+\"Old\""
        val first = declaration.indexOf("Old")
        val second = declaration.indexOf("Old", first + 1)
        val edits = listOf(FormulaNameEdit(first, first + 3, "'New name'"), FormulaNameEdit(second, second + 3, "'New name'"))
        val projected = requireNotNull(projectOpaqueModelTemplate(template, declaration, edits))
        val renamed = applyFormulaNameEdits(declaration, edits)
        assertEquals("=@col1[r1]+${StoredFormulaCodec.escape("@'New name'[1]:Missing[1]")}+\"Old\"", projected)
        assertEquals(2, requireNotNull(modelFormulaAssociations(projected, renamed)).size)
        assertNull(projectOpaqueModelTemplate(template, "=$declaration", edits))
    }

    @Test
    fun `changed expression is rejected rather than associated with the template`() {
        assertNull(modelFormulaRecipes("=@col1[r1]+2", "=@A[1]+3"))
        assertFailsWith<IllegalArgumentException> {
            instantiateStoredModelFormula("=@col1[r1]+2", "=@A[1]+3", "sheet", 0) { listOf("r1") }
        }
    }

    @Test
    fun `association rejects changed qualifier range and anchor recipes`() {
        assertNull(modelFormulaRecipes("=@col1[r1]", "=@Sheet!A[1]"))
        assertNull(modelFormulaRecipes("=@sheet!col1[r1]", "=@A[1]"))
        assertNull(modelFormulaRecipes("=@col1[r1]:col2[r2]", "=@A[1]"))
        assertNull(modelFormulaRecipes("=@col1[r1]", "=@\$A[1]"))
        assertNull(modelFormulaRecipes("=@\$col1[r1]", "=@A[1]"))
        assertNull(modelFormulaRecipes("=@col1[r1]", "=@A[\$1]"))
        assertNull(modelFormulaRecipes("=@col1[\$r1]", "=@A[1]"))
    }

    @Test
    fun `opaque association rejects incomplete and mismatched reference text`() {
        val declaration = "=prefix+@Missing[1]+2"
        val opaque = StoredFormulaCodec.escape("@Missing[1]")
        assertNull(modelFormulaAssociations("=prefix+${StoredFormulaCodec.escape("@Other[1]")}+2", declaration))
        assertNull(modelFormulaAssociations("=prefix+", declaration))
        assertNull(modelFormulaAssociations("=wrong+$opaque+2", declaration))
        assertNull(modelFormulaAssociations("=prefix+$opaque+3", declaration))
        assertNull(modelFormulaAssociations("=prefix+$opaque+2+@col1[r1]", declaration))
        assertEquals(1, requireNotNull(modelFormulaAssociations("=prefix+$opaque+2", declaration)).size)
    }
}
