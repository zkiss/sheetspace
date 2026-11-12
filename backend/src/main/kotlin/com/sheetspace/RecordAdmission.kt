package com.sheetspace

import java.security.MessageDigest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.Serializable

@Serializable
data class RecordRowOrder(val sheetId: String, val order: List<String>)

data class RecordAdmissionResult(val rowId: RowId, val alreadyCommitted: Boolean, val workbook: WorkbookState)
data class StoredRecordAdmission(val workbook: WorkbookState, val alreadyCommitted: Boolean)
data class RecordAdmissionStages(val appended: WorkbookState, val ordered: WorkbookState)

internal fun recordIdentity(value: String): String {
    val bytes = value.toUuidBytesOrNull() ?: throw invalidRecord()
    return bytes.toUuidString()
}

private fun invalidRecord() = WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)

internal data class PreparedRecordAdmission(
    val before: WorkbookState,
    val values: Map<String, String>,
    val orders: List<RecordRowOrder>,
    val fingerprint: String,
)

internal fun prepareRecordAdmission(revision: Long, values: Map<String, String>, before: WorkbookBundleResponse, orders: List<RecordRowOrder>): PreparedRecordAdmission {
    val normalizedValues = values.entries.associate { recordIdentity(it.key) to it.value }
    if (normalizedValues.size != values.size || revision < 0) throw invalidRecord()
    val normalizedOrders = orders.map { order -> RecordRowOrder(recordIdentity(order.sheetId), order.order.map(::recordIdentity)) }
    if (normalizedOrders.map { it.sheetId }.distinct().size != orders.size) throw invalidRecord()
    val normalizedBefore = normalizeRecordGuard(before)
    val payload = JsonObject(mapOf(
        "revision" to JsonPrimitive(revision),
        "values" to Json.encodeToJsonElement(normalizedValues),
        "before" to Json.encodeToJsonElement(WorkbookReadTransportAdapter.bundle(normalizedBefore)),
        "orders" to Json.encodeToJsonElement(normalizedOrders.sortedBy { it.sheetId }),
    ))
    return PreparedRecordAdmission(normalizedBefore, normalizedValues, normalizedOrders, recordFingerprint(payload))
}

internal fun normalizeRecordGuard(before: WorkbookBundleResponse): WorkbookState = try {
    Json.decodeFromJsonElement<WorkbookBundleResponse>(normalizeGuard(Json.encodeToJsonElement(before))).toLifecycleWorkbook()
} catch (_: IllegalArgumentException) {
    throw invalidRecord()
} catch (_: WorkbookApplicationException) {
    throw invalidRecord()
}

internal fun recordFingerprint(payload: JsonElement): String = MessageDigest.getInstance("SHA-256")
    .digest(canonicalRecordJson(payload).toString().toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

private val identityFields = setOf("id", "rowId", "columnId", "sheetId", "modelId", "rows", "columns", "sheetIds", "modelColumnBindings")
private val identityMaps = setOf("modelColumnBindings", "columnNames", "rowHeights", "columnWidths", "modelFormulaBindings", "rows", "columns")

private fun normalizeGuard(element: JsonElement, field: String = ""): JsonElement = when (element) {
    is JsonObject -> {
        val entries = element.entries.map { (key, value) ->
            val normalizedKey = when {
                field in identityMaps -> recordIdentity(key)
                field == "cells" -> key.split('\u0000').also { if (it.size != 2) throw invalidRecord() }.joinToString("\u0000", transform = ::recordIdentity)
                else -> key
            }
            normalizedKey to normalizeGuard(value, if (field == "modelColumnBindings") field else key)
        }
        if (entries.map { it.first }.distinct().size != entries.size) throw invalidRecord()
        JsonObject(entries.toMap())
    }
    is JsonArray -> JsonArray(element.map { normalizeGuard(it, if (it is JsonPrimitive) field else "") })
    is JsonPrimitive -> if (element.isString && field in identityFields) JsonPrimitive(recordIdentity(element.content)) else element
}

private fun canonicalRecordJson(element: JsonElement, field: String = ""): JsonElement = when (element) {
    is JsonObject -> JsonObject(element.toSortedMap().mapValues { (key, value) -> canonicalRecordJson(value, key) })
    is JsonArray -> {
        val values = element.map { canonicalRecordJson(it) }
        JsonArray(if (field in setOf("documents", "dataModels", "cells")) values.sortedBy { it.toString() } else values)
    }
    else -> element
}

internal fun guardRecordWorkbook(current: WorkbookState, before: WorkbookState) {
    before.documents.forEach { (id, expected) ->
        val actual = current.findSheet(id) ?: throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND, id.value)
        if (actual.revision != expected.revision) throw SheetRevisionConflict(id.value, expected.revision, actual.revision)
    }
    if (current != before) throw WorkbookApplicationException(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT)
}

internal fun applyRecordOrders(workbook: WorkbookState, orders: List<RecordRowOrder>): WorkbookState = orders.fold(workbook) { updated, order ->
    val id = SheetId(order.sheetId)
    val sheet = updated.findSheet(id) ?: throw WorkbookApplicationException(WorkbookApplicationError.SHEET_NOT_FOUND, id.value)
    val rows = order.order.map(::RowId)
    if (rows.size != sheet.tabularContent.rows.size || rows.toSet() != sheet.tabularContent.rows.toSet()) throw invalidRecord()
    updated.replaceSheet(sheet.copy(content = TabularContent(rows, sheet.tabularContent.columns, sheet.tabularContent.cellContents)))
}
