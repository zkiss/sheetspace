package com.sheetspace

/**
 * The small, non-evaluating part of the formula language shared with the client.  Formula text is
 * deliberately transformed by spans, rather than by a regular expression: a reference-looking
 * string literal is not a reference.
 */
internal object FormulaReferenceContract {
    data class Endpoint(
        val column: Int,
        val row: Int,
        val columnAnchored: Boolean,
        val rowAnchored: Boolean,
        val span: IntRange,
        val canonical: Boolean = false,
        val columnId: String? = null,
        val rowId: String? = null,
    )
    data class Reference(val qualifier: String?, val qualifierSpan: IntRange?, val endpoints: List<Endpoint>, val span: IntRange)

    fun isFormula(raw: String): Boolean = raw.startsWith("=") && raw.length > 1 &&
        (ERROR_LITERAL.matches(raw.drop(1)) || Parser(raw).valid())

    /** Converts an A1 template using the complete candidate workbook, as the client does. */
    fun canonicalize(raw: String, workbook: WorkbookState, currentSheetId: SheetId): String? {
        if (!isFormula(raw)) return null
        return transform(raw, references(raw)) { reference ->
            if (reference.endpoints.first().canonical) return@transform emptyList()
            val target = targetForStorage(reference.qualifier, workbook, currentSheetId)
                ?: return@transform listOf(reference.span to "#REF!")
            val replacements = mutableListOf<Pair<IntRange, String>>()
            if (reference.qualifier != null) replacements += reference.qualifierSpan!! to target.id.value
            reference.endpoints.forEach { endpoint ->
                val column = target.tabularContent.columns.getOrNull(endpoint.column)?.value
                val row = target.tabularContent.rows.getOrNull(endpoint.row)?.value
                if (column == null || row == null) return@transform listOf(reference.span to "#REF!")
                replacements += endpoint.span to "${if (endpoint.columnAnchored) "$" else ""}$column[${if (endpoint.rowAnchored) "$" else ""}$row]"
            }
            replacements
        }
    }

    /** Copies canonical references with the same explicit-sheet behavior as copyCanonicalFormula. */
    fun copyCanonical(
        raw: String,
        source: CellCoordinate,
        destination: CellCoordinate,
        workbook: WorkbookState,
        currentSheetId: SheetId,
        sourceSheetId: SheetId = currentSheetId,
        destinationSheetId: SheetId = sourceSheetId,
    ): String? {
        if (!isFormula(raw)) return null
        val sourceContent = workbook.findSheet(sourceSheetId)?.tabularContent ?: return null
        val destinationContent = workbook.findSheet(destinationSheetId)?.tabularContent ?: return null
        val sourceColumn = sourceContent.columns.indexOf(source.columnId)
        val sourceRow = sourceContent.rows.indexOf(source.rowId)
        val destinationColumn = destinationContent.columns.indexOf(destination.columnId)
        val destinationRow = destinationContent.rows.indexOf(destination.rowId)
        if (sourceColumn < 0 || sourceRow < 0 || destinationColumn < 0 || destinationRow < 0) return null
        var unresolved = false
        val result = transform(raw, references(raw).filter { it.endpoints.first().canonical }) { reference ->
            val originalSheet = if (reference.qualifier == null) workbook.findSheet(sourceSheetId)
            else workbook.findSheet(SheetId(reference.qualifier))
            val resultSheet = if (reference.qualifier == null) workbook.findSheet(destinationSheetId) else originalSheet
            if (originalSheet == null || resultSheet == null) { unresolved = true; return@transform emptyList() }
            reference.endpoints.map { endpoint ->
                val initialColumn = originalSheet.tabularContent.columns.indexOfFirst { it.value == endpoint.columnId }
                val initialRow = originalSheet.tabularContent.rows.indexOfFirst { it.value == endpoint.rowId }
                val column = if (endpoint.columnAnchored) initialColumn else initialColumn + destinationColumn - sourceColumn
                val row = if (endpoint.rowAnchored) initialRow else initialRow + destinationRow - sourceRow
                val columnId = resultSheet.tabularContent.columns.getOrNull(column)?.value
                val rowId = resultSheet.tabularContent.rows.getOrNull(row)?.value
                if (initialColumn < 0 || initialRow < 0 || columnId == null || rowId == null) { unresolved = true; return@map endpoint.span to "" }
                endpoint.span to "${if (endpoint.columnAnchored) "$" else ""}$columnId[${if (endpoint.rowAnchored) "$" else ""}$rowId]"
            }
        }
        return if (unresolved) null else result
    }

    /** References are exposed for conformance tests and future aggregate transition validation. */
    fun references(raw: String): List<Reference> = Parser(raw).references()

    private fun targetForStorage(qualifier: String?, workbook: WorkbookState, currentSheetId: SheetId): SheetDocument? =
        when (qualifier) {
            null -> workbook.findSheet(currentSheetId)
            "#REF" -> null
            else -> workbook.sheetsInOrder.firstOrNull { it.id.value == qualifier || it.name == qualifier }
        }

    private fun transform(raw: String, references: List<Reference>, replacement: (Reference) -> List<Pair<IntRange, String>>): String {
        val edits = references.flatMap(replacement)
        return edits.sortedByDescending { it.first.first }.fold(raw) { result, edit ->
            // Parser spans are relative to the expression (after the leading '=') while raw
            // includes it.
            result.substring(0, edit.first.first + 1) + edit.second + result.substring(edit.first.last + 2)
        }
    }

    private class Parser(private val raw: String) {
        private val input = raw.drop(1)
        private var index = 0
        private val found = mutableListOf<Reference>()

        fun valid(): Boolean { skip(); if (!expression()) return false; skip(); return index == input.length }
        fun references(): List<Reference> { valid(); return found.toList() }
        private fun expression(): Boolean = comparison()
        private fun comparison(): Boolean { if (!additive()) return false; skip(); if (operator(listOf("<>", "<=", ">=", "=", "<", ">"))) return additive(); return true }
        private fun additive(): Boolean { if (!multiplicative()) return false; while (true) { skip(); if (!operator(listOf("+", "-"))) return true; if (!multiplicative()) return false } }
        private fun multiplicative(): Boolean { if (!unary()) return false; while (true) { skip(); if (!operator(listOf("*", "/"))) return true; if (!unary()) return false } }
        private fun unary(): Boolean {
            skip(); if (take('+') || take('-')) return unary()
            if (take('(')) { if (!expression()) return false; skip(); return take(')') }
            if (peek() == '"') return text()
            if (peek() == '@') return reference()
            number()?.let { return true }
            val start = index; val identifier = identifier()
            if (identifier != null) {
                skip()
                if (take('(')) { skip(); if (take(')')) return true; do { if (!expression()) return false; skip() } while (take(',')); return take(')') }
                if (identifier.equals("TRUE", true) || identifier.equals("FALSE", true)) return true
                index = start
            }
            return false
        }
        private fun reference(): Boolean {
            val start = index; if (!take('@')) return false
            val qualifierStart = index; val qualifier = qualifier()
            val first = endpoint() ?: return false; skip()
            val endpoints = mutableListOf(first)
            if (take(':')) { skip(); val second = endpoint() ?: return false; if (second.canonical != first.canonical) return false; endpoints += second }
            found += Reference(qualifier?.first, qualifier?.second, endpoints, start..(index - 1)); return true
        }
        private fun qualifier(): Pair<String, IntRange>? {
            val start = index
            if (peek() == '\'') {
                index++; val value = StringBuilder()
                while (index < input.length) { if (input[index] != '\'') value.append(input[index++]) else if (index + 1 < input.length && input[index + 1] == '\'') { value.append('\''); index += 2 } else { index++; skip(); if (!take('!')) return null; skip(); return value.toString() to (start..index - 2) } }
                return null
            }
            val match = Regex("(?:[A-Za-z0-9_][A-Za-z0-9_.-]*|#REF)\\s*!").find(input, index)
            if (match?.range?.first != index) return null
            index = match.range.last + 1; val value = match.value.dropLast(1).trim(); skip(); return value to (start..(start + value.length - 1))
        }
        private fun endpoint(): Endpoint? {
            val start = index; val match = Regex("(\\$?)([A-Za-z0-9_:-]+)\\[(\\$?)([A-Za-z0-9_:-]+)]").find(input, index)
            if (match != null && match.range.first == index) {
                index = match.range.last + 1; val token = match.groupValues[2]
                if (!token.all { it.isLetter() }) {
                    // Canonical IDs are already stable.  Store their address as a sentinel; copy
                    // preserves their spelling below by returning it unchanged.
                    return Endpoint(-1, -1, match.groupValues[1] == "$", match.groupValues[3] == "$", start..match.range.last, true, token, match.groupValues[4])
                }
            }
            index = start; val a1 = Regex("(\\$?)([A-Za-z]+)\\[(\\$?)([1-9][0-9]*)]").find(input, index) ?: return null
            if (a1.range.first != index) return null; index = a1.range.last + 1
            if (index < input.length && input[index].isLetterOrDigit()) return null
            return Endpoint(column(a1.groupValues[2]), a1.groupValues[4].toInt() - 1, a1.groupValues[1] == "$", a1.groupValues[3] == "$", start..a1.range.last)
        }
        private fun text(): Boolean { index++; while (index < input.length) { if (input[index] != '"') index++ else if (index + 1 < input.length && input[index + 1] == '"') index += 2 else { index++; return true } }; return false }
        private fun number(): String? { val match = Regex("(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?").find(input, index) ?: return null; if (match.range.first != index) return null; index = match.range.last + 1; return match.value }
        private fun identifier(): String? { val match = Regex("[A-Za-z][A-Za-z0-9_]*").find(input, index) ?: return null; if (match.range.first != index) return null; index = match.range.last + 1; return match.value }
        private fun column(label: String): Int = label.fold(0) { value, char -> value * 26 + (char.uppercaseChar() - 'A' + 1) } - 1
        private fun operator(values: List<String>): Boolean = values.firstOrNull { input.startsWith(it, index) }?.also { index += it.length } != null
        private fun skip() { while (index < input.length && input[index].isWhitespace()) index++ }
        private fun take(char: Char): Boolean = (peek() == char).also { if (it) index++ }
        private fun peek(): Char? = input.getOrNull(index)
    }

    private val ERROR_LITERAL = Regex("#[A-Za-z0-9/!?]+")
}
