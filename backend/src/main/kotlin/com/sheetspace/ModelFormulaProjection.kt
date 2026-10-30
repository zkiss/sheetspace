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

internal fun renamedDeclarationEdits(before: WorkbookState, after: WorkbookState, model: DataModel, declaration: String): List<FormulaNameEdit> {
    fun resolve(qualifier: String?, name: String): String? {
        if (qualifier == null) {
            val property = model.columns.find { it.name == name } ?: return null
            return after.dataModels[model.id]?.columns?.find { it.id == property.id }?.name
        }
        val sheet = before.documents.values.find { it.name == qualifier } ?: return null
        val next = after.documents[sheet.id] ?: return null
        val property = sheet.modelId?.let(before.dataModels::get)?.columns?.find { it.name == name && it.id in sheet.modelColumnBindings }
        if (property != null) {
            val column = sheet.modelColumnBindings[property.id] ?: return null
            if (next.modelId != sheet.modelId || next.modelColumnBindings[property.id] != column) return null
            return next.modelId?.let(after.dataModels::get)?.columns?.find { it.id == property.id }?.name
        }
        val column = sheet.columnNames.entries.find { it.value == name }?.key ?: return null
        return next.columnNames[column]
    }
    return inlineFormulaReferences(declaration, false).flatMap { reference ->
        reference.endpoints.mapNotNull { endpoint ->
            val name = resolve(reference.qualifier, endpoint.column) ?: return@mapNotNull null
            if (name == endpoint.column) return@mapNotNull null
            val start = endpoint.start + if (endpoint.columnAnchor) 1 else 0
            val end = if (declaration[start] == '\'') {
                var cursor = start + 1
                while (cursor < declaration.length) {
                    if (declaration[cursor++] == '\'') {
                        if (declaration.getOrNull(cursor) != '\'') break
                        cursor++
                    }
                }
                cursor
            } else start + endpoint.column.length
            val token = if (Regex("[A-Za-z][A-Za-z0-9_]*").matches(name)) name else "'${name.replace("'", "''")}'"
            FormulaNameEdit(start, end, token)
        }
    }
}
