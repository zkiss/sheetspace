package com.sheetspace

internal data class ModelReferenceRecipe(val declaration: InlineFormulaReference, val stored: InlineFormulaReference)
internal data class ModelReferenceAssociation(val declaration: InlineFormulaReference, val stored: InlineFormulaReference?, val start: Int, val end: Int)

/** Unchanged expression gaps and endpoint shapes associate canonical tokens with row recipes. */
internal fun modelFormulaRecipes(content: String, declaration: String): List<ModelReferenceRecipe>? {
    return modelFormulaAssociations(content, declaration)?.mapNotNull { association ->
        association.stored?.let { ModelReferenceRecipe(association.declaration, it) }
    }
}

internal fun modelFormulaAssociations(content: String, declaration: String): List<ModelReferenceAssociation>? {
    StoredFormulaCodec.require(content)
    val canonical = inlineFormulaReferences(content, true)
    val raw = StoredFormulaCodec.opaqueText(content)
    fun decode(start: Int, end: Int): String {
        var text = content.substring(start, end)
        raw.filter { it.start >= start && it.end <= end }.asReversed().forEach {
            text = text.substring(0, it.start - start) + it.text + text.substring(it.end - start)
        }
        return text
    }
    val associations = mutableListOf<ModelReferenceAssociation>()
    var sourceCursor = 0
    var storedCursor = 0
    var canonicalIndex = 0
    inlineFormulaReferences(declaration, false).forEach { reference ->
        val gap = declaration.substring(sourceCursor, reference.start)
        val next = canonical.getOrNull(canonicalIndex)
        if (next != null && decode(storedCursor, next.start) == gap) {
            if (reference.endpoints.size != next.endpoints.size || (reference.qualifier == null) != (next.qualifier == null) || reference.endpoints.zip(next.endpoints).any { (source, target) -> source.columnAnchor != target.columnAnchor || source.rowAnchor != target.rowAnchor }) return null
            associations.add(ModelReferenceAssociation(reference, next, next.start, next.end))
            storedCursor = next.end
            canonicalIndex++
        } else {
            val expected = gap + declaration.substring(reference.start, reference.end)
            var end = storedCursor
            while (end <= content.length && decode(storedCursor, end).length < expected.length) {
                end = raw.firstOrNull { it.start == end }?.end ?: (end + 1)
            }
            if (end > content.length || decode(storedCursor, end) != expected) return null
            var referenceStart = storedCursor
            while (referenceStart < end && decode(storedCursor, referenceStart).length < gap.length) {
                referenceStart = raw.firstOrNull { it.start == referenceStart }?.end ?: (referenceStart + 1)
            }
            if (decode(storedCursor, referenceStart) != gap) return null
            associations.add(ModelReferenceAssociation(reference, null, referenceStart, end))
            storedCursor = end
        }
        sourceCursor = reference.end
    }
    return if (canonicalIndex == canonical.size && decode(storedCursor, content.length) == declaration.substring(sourceCursor)) associations else null
}

internal fun instantiateStoredModelFormula(template: String, declaration: String, currentSheetId: String, rowIndex: Int, rowsForSheet: (String) -> List<String>?): String {
    val recipes = requireNotNull(modelFormulaRecipes(template, declaration)) { "Stored model formula does not match declaration" }
    var content = template
    recipes.asReversed().forEach { (source, stored) ->
        val rows = rowsForSheet(stored.qualifier ?: currentSheetId) ?: return@forEach
        val endpoints = stored.endpoints.mapIndexed { index, endpoint ->
            val recipe = source.endpoints[index]
            val rowIndexLong = recipe.row.toLong() - 1 + if (recipe.rowAnchor) 0 else rowIndex.toLong()
            val row = if (rowIndexLong in 0 until rows.size.toLong()) rows[rowIndexLong.toInt()] else null
            if (row == null) null else formatInlineEndpoint(endpoint, row)
        }
        val replacement = if (endpoints.any { it == null }) StoredFormulaCodec.escape(declaration.substring(source.start, source.end))
            else "@" + (stored.qualifier?.let { "$it!" } ?: "") + endpoints.joinToString(":")
        content = content.substring(0, stored.start) + replacement + content.substring(stored.end)
    }
    return content
}

private fun formatInlineEndpoint(endpoint: InlineFormulaEndpoint, row: String): String {
    fun hex(value: String) = value.map { it.code.toString(16).padStart(4, '0') }.joinToString("")
    val column = endpoint.property?.let { "~${hex(it)}~${hex(endpoint.column)}" } ?: endpoint.column
    return (if (endpoint.columnAnchor) "$" else "") + column + "[" + (if (endpoint.rowAnchor) "$" else "") + (if (endpoint.property != null) hex(row) else row) + "]"
}
