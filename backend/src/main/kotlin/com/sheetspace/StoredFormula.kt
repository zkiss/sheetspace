package com.sheetspace

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

internal data class FormulaSpan(val start: Int, val end: Int)
internal data class FormulaSlot(val id: String, val kind: String, val key: JsonPrimitive, val status: String, val targetIds: List<String>)
internal data class FormulaEndpoint(val id: String, val columnSlotId: String, val rowSlotId: String, val columnAnchor: Boolean, val rowAnchor: Boolean)
internal data class FormulaOrigin(val start: Int, val end: Int, val slotId: String?)
internal data class FormulaOccurrence(
    val id: String,
    val guard: FormulaSpan,
    val sheetSlotId: String,
    val endpoints: List<FormulaEndpoint>,
    val slots: List<FormulaSlot>,
    val origins: List<FormulaOrigin>,
)
internal data class StoredFormula(val text: String, val occurrences: List<FormulaOccurrence>)

/** Explicit stored-content codec. User input must never be interpreted by its marker spelling. */
internal object StoredFormulaCodec {
    private const val MARKER = "=~F1"
    private val blankId = Regex("^[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*$")
    private val jsonNumber = Regex("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")

    fun decode(content: String): StoredFormula {
        require(content.startsWith(MARKER)) { "Invalid stored formula" }
        rejectUnescapedControls(content.substring(MARKER.length))
        val payload = try {
            Json.parseToJsonElement(content.substring(MARKER.length))
        } catch (_: IllegalArgumentException) {
            invalid()
        }
        val values = tuple(payload, 2)
        val text = string(values[0])
        requireValid(text.startsWith("="))
        val formula = StoredFormula(text, array(values[1]).map(::readOccurrence))
        validateLayout(formula)
        return formula
    }

    fun encode(formula: StoredFormula): String {
        val payload = list(formula.text.json(), JsonArray(formula.occurrences.map { occurrence ->
            list(
                occurrence.id.json(), list(occurrence.guard.start.json(), occurrence.guard.end.json()), occurrence.sheetSlotId.json(),
                JsonArray(occurrence.endpoints.map { endpoint ->
                    list(endpoint.id.json(), endpoint.columnSlotId.json(), endpoint.rowSlotId.json(), endpoint.columnAnchor.json(), endpoint.rowAnchor.json())
                }),
                JsonArray(occurrence.slots.map { slot ->
                    list(slot.id.json(), slot.kind.json(), slot.key, slot.status.json(), JsonArray(slot.targetIds.map { it.json() }))
                }),
                JsonArray(occurrence.origins.map { origin -> list(origin.start.json(), origin.end.json(), origin.slotId?.json() ?: JsonNull) }),
            )
        }))
        decode(MARKER + payload.toString())
        return MARKER + canonicalJson(payload)
    }

    private fun readOccurrence(value: JsonElement): FormulaOccurrence {
        val values = tuple(value, 6)
        val guard = tuple(values[1], 2)
        val occurrence = FormulaOccurrence(
            identifier(values[0]), FormulaSpan(offset(guard[0]), offset(guard[1])), identifier(values[2]),
            array(values[3]).map(::readEndpoint), array(values[4]).map(::readSlot),
            array(values[5]).map { origin ->
                val parts = tuple(origin, 3)
                FormulaOrigin(offset(parts[0]), offset(parts[1]), if (parts[2] == JsonNull) null else identifier(parts[2]))
            },
        )
        unique(occurrence.slots.map { it.id })
        unique(occurrence.endpoints.map { it.id })
        val slots = occurrence.slots.associateBy { it.id }
        requireValid(slots[occurrence.sheetSlotId]?.kind == "sheet" && occurrence.endpoints.size <= 2)
        val usedSlots = mutableSetOf(occurrence.sheetSlotId)
        occurrence.endpoints.forEach { endpoint ->
            requireValid(slots[endpoint.columnSlotId]?.kind in setOf("column", "property") && slots[endpoint.rowSlotId]?.kind == "row")
            requireValid(usedSlots.add(endpoint.columnSlotId) && usedSlots.add(endpoint.rowSlotId))
        }
        requireValid(occurrence.origins.all { it.slotId == null || it.slotId in slots })
        return occurrence
    }

    private fun readEndpoint(value: JsonElement): FormulaEndpoint {
        val values = tuple(value, 5)
        return FormulaEndpoint(identifier(values[0]), identifier(values[1]), identifier(values[2]), boolean(values[3]), boolean(values[4]))
    }

    private fun readSlot(value: JsonElement): FormulaSlot {
        val values = tuple(value, 5)
        val kind = string(values[1])
        val status = string(values[3])
        requireValid(kind in setOf("sheet", "column", "property", "row"))
        requireValid(status in setOf("retained", "unresolved", "replaced"))
        var key = values[2] as? JsonPrimitive ?: invalid()
        if (key != JsonNull) {
            if (kind == "sheet" || kind == "property") {
                requireValid(key.isString)
            } else {
                val number = number(key)
                requireValid(number % 1.0 == 0.0 && number >= (if (kind == "row") 1 else 0) && number <= 9007199254740991.0)
                key = JsonPrimitive(number.toLong())
            }
        }
        val targets = array(values[4]).map(::identifier)
        requireValid(targets.size == if (status == "retained") (if (kind == "property") 2 else 1) else 0)
        return FormulaSlot(identifier(values[0]), kind, key, status, targets)
    }

    private fun validateLayout(formula: StoredFormula) {
        unique(formula.occurrences.map { it.id })
        var previousEnd = 0
        formula.occurrences.forEach { occurrence ->
            val guard = occurrence.guard
            requireValid(guard.start >= previousEnd && guard.start < guard.end && guard.end <= formula.text.length)
            previousEnd = guard.end
            var ownedEnd = guard.start
            var previous: FormulaOrigin? = null
            occurrence.origins.forEach { origin ->
                requireValid(origin.start >= guard.start && origin.end <= guard.end && origin.start <= origin.end && origin.start >= ownedEnd)
                previous?.let { requireValid(compareOrigins(it, origin) < 0) }
                ownedEnd = origin.end
                previous = origin
            }
        }
    }

    private fun compareOrigins(left: FormulaOrigin, right: FormulaOrigin): Int =
        compareValuesBy(left, right, { it.start }, { it.end }, { it.slotId })

    private fun tuple(value: JsonElement, size: Int): JsonArray = array(value).also { requireValid(it.size == size) }
    private fun array(value: JsonElement): JsonArray = value as? JsonArray ?: invalid()
    private fun string(value: JsonElement): String {
        val primitive = value as? JsonPrimitive ?: invalid()
        requireValid(primitive.isString)
        return primitive.content
    }
    private fun identifier(value: JsonElement): String = string(value).also { requireValid(!blankId.matches(it)) }
    private fun offset(value: JsonElement): Int {
        val number = number(value)
        requireValid(number % 1.0 == 0.0 && number >= 0 && number <= Int.MAX_VALUE)
        return number.toInt()
    }
    private fun number(value: JsonElement): Double {
        val primitive = value as? JsonPrimitive ?: invalid()
        requireValid(!primitive.isString && jsonNumber.matches(primitive.content))
        return primitive.doubleOrNull?.takeIf { it.isFinite() } ?: invalid()
    }
    private fun boolean(value: JsonElement): Boolean {
        val primitive = value as? JsonPrimitive ?: invalid()
        requireValid(!primitive.isString)
        return primitive.booleanOrNull ?: invalid()
    }
    private fun unique(ids: List<String>) = requireValid(ids.distinct().size == ids.size)
    private fun requireValid(valid: Boolean) { if (!valid) invalid() }
    private fun invalid(): Nothing = throw IllegalArgumentException("Invalid stored formula")
    private fun list(vararg values: JsonElement) = JsonArray(values.toList())
    private fun String.json() = JsonPrimitive(this)
    private fun Int.json() = JsonPrimitive(this)
    private fun Boolean.json() = JsonPrimitive(this)

    // kotlinx.serialization accepts raw string controls that JSON.parse rejects.
    private fun rejectUnescapedControls(json: String) {
        var quoted = false
        var escaped = false
        json.forEach { char ->
            requireValid(!quoted || char.code >= 32)
            if (escaped) escaped = false
            else if (quoted && char == '\\') escaped = true
            else if (char == '"') quoted = !quoted
        }
    }

    private fun canonicalJson(value: JsonElement): String = when (value) {
        is JsonArray -> value.joinToString(",", "[", "]", transform = ::canonicalJson)
        is JsonPrimitive -> if (value.isString) quote(value.content) else canonicalNumberOrLiteral(value)
        else -> invalid()
    }

    private fun canonicalNumberOrLiteral(value: JsonPrimitive): String {
        val number = value.doubleOrNull
        return if (number != null) number.toLong().toString() else value.toString()
    }

    /** JSON.stringify escapes lone UTF-16 surrogates; preserve those code units across JVM I/O. */
    private fun quote(value: String): String = buildString {
        append('"')
        value.forEachIndexed { index, char ->
            when (char) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000c' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> {
                    val paired = (char.isHighSurrogate() && value.getOrNull(index + 1)?.isLowSurrogate() == true) ||
                        (char.isLowSurrogate() && value.getOrNull(index - 1)?.isHighSurrogate() == true)
                    if (char.code < 32 || (char.isSurrogate() && !paired)) append("\\u" + char.code.toString(16).padStart(4, '0')) else append(char)
                }
            }
        }
        append('"')
    }
}
