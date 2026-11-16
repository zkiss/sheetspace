package com.sheetspace

import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.*

private val lifecycleJson = Json { encodeDefaults = true }

internal fun CustomFunction.hasSameBindingSource(other: CustomFunction): Boolean =
    body == other.body && parameters.map { it.name } == other.parameters.map { it.name }

/** Compare semantic identities rather than transport list positions or storage revisions. */
internal fun replayLifecycleWorkbook(current: WorkbookState, expected: WorkbookState, target: WorkbookState, provenance: List<ReplayBindingProvenance> = emptyList()): WorkbookState {
    val expectedDocuments = expected.documents.mapValues { (id, sheet) ->
        val live = current.documents[id]
        if (id !in target.documents && live != null) {
            sheet.copy(frame = sheet.frame.copy(position = live.frame.position, size = live.frame.size))
        } else {
            sheet
        }
    }
    val a = lifecycleProjection(expected.copy(documents = expectedDocuments))
    val b = lifecycleProjection(target)
    val c = lifecycleProjection(current)
    val merged = replayLifecycleDelta(
        JsonObject(c - "functions"), JsonObject(a - "functions"), JsonObject(b - "functions"),
    )!!.jsonObject.toMutableMap()
    merged["functions"] = JsonArray(c.getValue("functions").jsonObject.values.toList())
    merged["dataModels"] = JsonArray(merged.getValue("dataModels").jsonObject.values.toList())
    val documents = merged.getValue("documents").jsonObject
    val order = merged.getValue("manifest").jsonObject.getValue("sheetIds").jsonArray
    merged["documents"] = JsonArray(order.map { id ->
        val document = documents.getValue(id.jsonPrimitive.content).jsonObject.toMutableMap()
        val content = document.getValue("content").jsonObject.toMutableMap()
        content["cells"] = JsonArray(content.getValue("cells").jsonObject.values.toList())
        document["content"] = JsonObject(content)
        document["revision"] = JsonPrimitive(current.documents[SheetId(id.jsonPrimitive.content)]?.revision ?: 0)
        JsonObject(document)
    })
    val manifest = merged.getValue("manifest").jsonObject.toMutableMap()
    manifest["revision"] = JsonPrimitive(current.manifest.revision + if (order != c.getValue("manifest").jsonObject.getValue("sheetIds").jsonArray) 1 else 0)
    merged["manifest"] = JsonObject(manifest)
    var result = Json.decodeFromString<WorkbookBundleResponse>(JsonObject(merged).toString()).toLifecycleWorkbook()
    val removed = current.documents.keys - result.documents.keys
    val added = result.documents.keys - current.documents.keys
    result = result.copy(functions = result.functions.map { it.copy(bodyBindings = it.bodyBindings - removed.map { id -> id.value }.toSet()) })
    for (id in added) {
        val prepared = if (result.functions.isEmpty()) emptyList() else SharedFunctionAdmission.bindSheet(result, id)
        result = result.copy(functions = result.functions.mapIndexed { index, function ->
            val captured = provenance.find { it.caller.id == id.value && function.identity.isNotEmpty() && it.declaration.identity == function.identity && it.declaration.hasSameBindingSource(function) }
            val binding = if (captured != null) captured.binding else prepared[index].bodyBindings[id.value]
            if (binding == null) function else function.copy(bodyBindings = function.bodyBindings + (id.value to binding))
        })
    }
    return result
}

private fun lifecycleProjection(workbook: WorkbookState): JsonObject {
    val bundle = lifecycleJson.parseToJsonElement(lifecycleJson.encodeToString(WorkbookReadTransportAdapter.bundle(workbook))).jsonObject.toMutableMap()
    val manifest = bundle.getValue("manifest").jsonObject.toMutableMap()
    manifest["revision"] = JsonPrimitive(0)
    bundle["manifest"] = JsonObject(manifest)
    bundle["documents"] = JsonObject(bundle.getValue("documents").jsonArray.associate { item ->
        val document = item.jsonObject.toMutableMap()
        val id = document.getValue("id").jsonPrimitive.content
        document["revision"] = JsonPrimitive(0)
        val content = document.getValue("content").jsonObject.toMutableMap()
        content["cells"] = JsonObject(content.getValue("cells").jsonArray.associate { cell ->
            val obj = cell.jsonObject
            "${obj.getValue("rowId").jsonPrimitive.content}:${obj.getValue("columnId").jsonPrimitive.content}" to cell
        })
        document["content"] = JsonObject(content)
        id to JsonObject(document)
    })
    bundle["dataModels"] = JsonObject(bundle.getValue("dataModels").jsonArray.associate { it.jsonObject.getValue("id").jsonPrimitive.content to it })
    bundle["functions"] = JsonObject(bundle.getValue("functions").jsonArray.associate { it.jsonObject.getValue("name").jsonPrimitive.content.lowercase() to it })
    return JsonObject(bundle)
}
