package com.sheetspace

internal data class FormulaNameEdit(val start: Int, val end: Int, val text: String)

internal fun applyFormulaNameEdits(text: String, edits: List<FormulaNameEdit>): String =
    edits.sortedByDescending { it.start }.fold(text) { result, edit ->
        result.substring(0, edit.start) + edit.text + result.substring(edit.end)
    }

internal fun projectOpaqueModelTemplate(content: String, declaration: String, edits: List<FormulaNameEdit>): String? {
    val associations = modelFormulaAssociations(content, declaration) ?: return null
    val replacements = associations.mapNotNull { association ->
        if (association.stored != null) return@mapNotNull null
        val reference = association.declaration
        val matching = edits.filter { it.start >= reference.start && it.end <= reference.end }
        if (matching.isEmpty()) return@mapNotNull null
        val relative = matching.map { FormulaNameEdit(it.start - reference.start, it.end - reference.start, it.text) }
        val source = declaration.substring(reference.start, reference.end)
        FormulaNameEdit(association.start, association.end, StoredFormulaCodec.escape(applyFormulaNameEdits(source, relative)))
    }
    return applyFormulaNameEdits(content, replacements)
}
