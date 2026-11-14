package com.sheetspace

import java.sql.Connection
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
internal data class ReplayBindingProvenance(
    val caller: SheetDocumentResponse,
    val declaration: CustomFunction,
    val binding: String?,
)

/** Private transition state; all operations participate in the caller's JDBC transaction. */
internal class SqliteReplayBindingProvenance(private val connection: Connection) {
    fun advanceMutation(current: WorkbookState, result: FunctionMutationResult) {
        val previous = result.previous ?: return
        val next = result.next
        val documents = WorkbookReadTransportAdapter.bundle(result.workbook).documents.associateBy { it.id }
        for ((transition, state) in all()) {
            if (state.declaration.identity != previous.identity) continue
            if (!state.declaration.hasSameBindingSource(previous) || next == null ||
                previous.parameters.map { it.name } != next.parameters.map { it.name }
            ) {
                remove(transition, state.caller.id, state.declaration.identity)
                continue
            }
            val live = documents[state.caller.id]
            val binding = if (live != null) next.bodyBindings[live.id]
                else SharedFunctionAdmission.reconcileAbsentBinding(current, state, next)
            advance(transition, state, ReplayBindingProvenance(live ?: state.caller, next.copy(bodyBindings = emptyMap()), binding))
        }
    }

    fun refreshRemoved(current: WorkbookState, removed: Set<SheetId>) {
        if (removed.isEmpty()) return
        val documents = WorkbookReadTransportAdapter.bundle(current).documents.associateBy { it.id }
        for ((transition, state) in all()) {
            if (SheetId(state.caller.id) !in removed) continue
            val definition = current.functions.find { it.identity.isNotEmpty() && it.identity == state.declaration.identity }
            if (definition == null || !definition.hasSameBindingSource(state.declaration)) {
                remove(transition, state.caller.id, state.declaration.identity)
            } else {
                put(transition, ReplayBindingProvenance(documents.getValue(state.caller.id), definition.copy(bodyBindings = emptyMap()), definition.bodyBindings[state.caller.id]))
            }
        }
        connection.createStatement().use { statement ->
            statement.executeQuery("SELECT transition_id, before_workbook, after_workbook FROM lifecycle_transitions").use { result ->
                while (result.next()) {
                    val transition = result.getBytes(1).toUuidString()
                    val before = Json.decodeFromString<WorkbookBundleResponse>(result.getString(2)).documents.map { it.id }.toSet()
                    val after = Json.decodeFromString<WorkbookBundleResponse>(result.getString(3)).documents.map { it.id }.toSet()
                    for (callerId in (before union after) - (before intersect after)) {
                        if (SheetId(callerId) !in removed) continue
                        val caller = documents.getValue(callerId)
                        for (definition in current.functions.filter { it.identity.isNotEmpty() }) {
                            put(transition, ReplayBindingProvenance(caller, definition.copy(bodyBindings = emptyMap()), definition.bodyBindings[callerId]))
                        }
                    }
                }
            }
        }
    }

    fun all(): List<Pair<String, ReplayBindingProvenance>> =
        connection.prepareStatement("SELECT transition_id, state FROM lifecycle_binding_provenance ORDER BY transition_id, caller_id, identity").use { statement ->
            statement.executeQuery().use { result ->
                buildList { while (result.next()) add(result.getBytes(1).toUuidString() to Json.decodeFromString<ReplayBindingProvenance>(result.getString(2))) }
            }
        }

    fun put(transitionId: String, state: ReplayBindingProvenance) {
        connection.prepareStatement(
            "INSERT OR REPLACE INTO lifecycle_binding_provenance (transition_id, caller_id, identity, state) VALUES (?, ?, ?, ?)",
        ).use { statement ->
            statement.setBytes(1, transitionId.toUuidBytes())
            statement.setString(2, state.caller.id)
            statement.setString(3, state.declaration.identity)
            statement.setString(4, Json.encodeToString(state))
            statement.executeUpdate()
        }
    }

    fun list(transitionId: String): List<ReplayBindingProvenance> =
        connection.prepareStatement("SELECT state FROM lifecycle_binding_provenance WHERE transition_id = ? ORDER BY caller_id, identity").use { statement ->
            statement.setBytes(1, transitionId.toUuidBytes())
            statement.executeQuery().use { result ->
                buildList { while (result.next()) add(Json.decodeFromString<ReplayBindingProvenance>(result.getString(1))) }
            }
        }

    fun remove(transitionId: String, callerId: String, identity: String) {
        connection.prepareStatement("DELETE FROM lifecycle_binding_provenance WHERE transition_id = ? AND caller_id = ? AND identity = ?").use { statement ->
            statement.setBytes(1, transitionId.toUuidBytes())
            statement.setString(2, callerId)
            statement.setString(3, identity)
            statement.executeUpdate()
        }
    }

    fun advance(transitionId: String, previous: ReplayBindingProvenance, next: ReplayBindingProvenance?) {
        remove(transitionId, previous.caller.id, previous.declaration.identity)
        if (next != null && previous.caller.id == next.caller.id &&
            previous.declaration.parameters.map { it.name } == next.declaration.parameters.map { it.name }
        ) put(transitionId, next)
    }
}
