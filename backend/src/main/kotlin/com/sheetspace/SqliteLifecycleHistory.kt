package com.sheetspace

import java.sql.Connection
import java.util.UUID
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

internal class SqliteLifecycleHistory(private val connection: Connection, private val reader: SqliteWorkbookReader) {
    fun endpoints(replay: PreparedLifecycleReplay): Pair<WorkbookState, WorkbookState> =
        connection.prepareStatement("SELECT before_workbook, after_workbook, applied FROM lifecycle_transitions WHERE transition_id = ?").use { statement ->
            statement.setBytes(1, replay.transitionId.toUuidBytes())
            statement.executeQuery().use { result ->
                if (!result.next()) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
                val applied = result.getInt(3) != 0
                if (applied != (replay.direction == "undo")) throw WorkbookApplicationException(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT)
                val before = Json.decodeFromString<WorkbookBundleResponse>(result.getString(1)).toLifecycleWorkbook()
                val after = Json.decodeFromString<WorkbookBundleResponse>(result.getString(2)).toLifecycleWorkbook()
                if (applied) after to before else before to after
            }
        }

    fun recordReplay(replay: PreparedLifecycleReplay, workbook: WorkbookState): StoredLifecycleAdmission {
        connection.prepareStatement("UPDATE lifecycle_transitions SET applied = ? WHERE transition_id = ?").use { statement ->
            statement.setInt(1, if (replay.direction == "redo") 1 else 0)
            statement.setBytes(2, replay.transitionId.toUuidBytes())
            statement.executeUpdate()
        }
        connection.prepareStatement("INSERT INTO lifecycle_receipts (operation_id, fingerprint, transition_id) VALUES (?, ?, ?)").use { statement ->
            statement.setBytes(1, replay.operationId.toUuidBytes())
            statement.setString(2, replay.fingerprint)
            statement.setBytes(3, replay.transitionId.toUuidBytes())
            statement.executeUpdate()
        }
        return StoredLifecycleAdmission(workbook, replay.transitionId, false)
    }
    fun receipt(operationId: String, fingerprint: String): StoredLifecycleAdmission? =
        connection.prepareStatement("SELECT fingerprint, transition_id FROM lifecycle_receipts WHERE operation_id = ?").use { statement ->
            statement.setBytes(1, operationId.toUuidBytes())
            statement.executeQuery().use { result ->
                if (!result.next()) return null
                if (result.getString(1) != fingerprint) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
                StoredLifecycleAdmission(reader.loadWorkbookBundle(), result.getBytes(2).toUuidString(), true)
            }
        }

    fun capture(operationId: String, fingerprint: String, before: WorkbookState, after: WorkbookState): StoredLifecycleAdmission {
        val transitionId = UUID.randomUUID().toString()
        connection.prepareStatement("INSERT INTO lifecycle_transitions (transition_id, before_workbook, after_workbook, applied) VALUES (?, ?, ?, 1)").use { statement ->
            statement.setBytes(1, transitionId.toUuidBytes())
            statement.setString(2, Json.encodeToString(WorkbookReadTransportAdapter.bundle(before)))
            statement.setString(3, Json.encodeToString(WorkbookReadTransportAdapter.bundle(after)))
            statement.executeUpdate()
        }
        val provenance = SqliteReplayBindingProvenance(connection)
        for ((source, other) in listOf(before to after, after to before)) {
            val bundle = WorkbookReadTransportAdapter.bundle(source)
            for (caller in bundle.documents.filter { SheetId(it.id) !in other.documents }) {
                for (definition in source.functions) {
                    provenance.put(transitionId, ReplayBindingProvenance(caller, definition.copy(bodyBindings = emptyMap()), definition.bodyBindings[caller.id]))
                }
            }
        }
        connection.prepareStatement("INSERT INTO lifecycle_receipts (operation_id, fingerprint, transition_id) VALUES (?, ?, ?)").use { statement ->
            statement.setBytes(1, operationId.toUuidBytes())
            statement.setString(2, fingerprint)
            statement.setBytes(3, transitionId.toUuidBytes())
            statement.executeUpdate()
        }
        return StoredLifecycleAdmission(after, transitionId, false)
    }
}
