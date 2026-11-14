package com.sheetspace

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Apply only the changes captured by a transition, guarding every changed value. */
internal fun replayLifecycleDelta(current: JsonElement?, expected: JsonElement?, target: JsonElement?): JsonElement? {
    if (expected == target) return current
    if (expected is JsonObject && target is JsonObject) {
        if (current !is JsonObject) throw lifecycleReplayConflict()
        val result = current.toMutableMap()
        for (key in expected.keys + target.keys) {
            val value = replayLifecycleDelta(current[key], expected[key], target[key])
            if (value == null) result.remove(key) else result[key] = value
        }
        return JsonObject(result)
    }
    if (current != expected) throw lifecycleReplayConflict()
    return target
}

private fun lifecycleReplayConflict() = WorkbookApplicationException(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT)
