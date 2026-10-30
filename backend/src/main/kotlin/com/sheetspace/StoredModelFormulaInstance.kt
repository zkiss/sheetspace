package com.sheetspace

import kotlinx.serialization.json.longOrNull

/** Check template structure, not the historical authority of an instance's row identities. */
internal fun storedModelInstanceMatchesTemplate(template: String, instance: String): Boolean = try {
    val expected = StoredFormulaCodec.decode(template)
    val actual = StoredFormulaCodec.decode(instance)
    expected.text == actual.text && expected.occurrences.size == actual.occurrences.size &&
        expected.occurrences.zip(actual.occurrences).all { (source, result) ->
            val rowSlots = source.endpoints.map { it.rowSlotId }.toSet()
            val sourceSlots = source.slots.associateBy { it.id }
            val normalized = result.copy(slots = result.slots.map { slot ->
                if (slot.id in rowSlots) {
                    val original = sourceSlots.getValue(slot.id)
                    slot.copy(status = original.status, targetIds = original.targetIds)
                } else {
                    slot
                }
            })
            source == normalized
        }
} catch (_: IllegalArgumentException) {
    false
}

/** Instantiate the row recipes in supplied provenance without interpreting formula text. */
internal fun instantiateStoredModelFormula(
    template: String,
    rowIndex: Int,
    rowsForSheet: (String) -> List<String>?,
): String {
    val formula = StoredFormulaCodec.decode(template)
    val occurrences = formula.occurrences.map { occurrence ->
        val sheet = occurrence.slots.first { it.id == occurrence.sheetSlotId }
        val rows = if (sheet.status == "retained") rowsForSheet(sheet.targetIds.single()) else null
        if (rows == null) return@map occurrence
        val rowEndpoints = occurrence.endpoints.associateBy { it.rowSlotId }
        occurrence.copy(slots = occurrence.slots.map slotMap@ { slot ->
            val endpoint = rowEndpoints[slot.id]
            val key = slot.key.longOrNull
            if (endpoint == null || key == null) return@slotMap slot
            val index = key - 1 + if (endpoint.rowAnchor) 0 else rowIndex.toLong()
            val row = if (index >= 0 && index < rows.size) rows[index.toInt()] else null
            slot.copy(status = if (row == null) "unresolved" else "retained", targetIds = listOfNotNull(row))
        })
    }
    return StoredFormulaCodec.encode(formula.copy(occurrences = occurrences))
}
