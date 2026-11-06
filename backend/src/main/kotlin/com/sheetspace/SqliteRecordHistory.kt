package com.sheetspace

import java.sql.Connection
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

internal class SqliteRecordHistory(private val connection: Connection, private val reader: SqliteWorkbookReader) {
    fun capture(sheetId: SheetId, rowId: RowId, fingerprint: String, before: WorkbookState, after: WorkbookState) {
        connection.prepareStatement("INSERT INTO record_admissions (sheet_id, row_id, fingerprint, before_workbook, after_workbook) VALUES (?, ?, ?, ?, ?)").use { statement ->
            statement.setBytes(1, sheetId.value.toUuidBytes())
            statement.setBytes(2, rowId.value.toUuidBytes())
            statement.setString(3, fingerprint)
            statement.setString(4, Json.encodeToString(WorkbookReadTransportAdapter.bundle(before)))
            statement.setString(5, Json.encodeToString(WorkbookReadTransportAdapter.bundle(after)))
            statement.executeUpdate()
        }
    }

    fun replay(request: PreparedRecordReplay): StoredRecordAdmission {
        val receipt = connection.prepareStatement("SELECT fingerprint FROM record_replays WHERE operation_id = ?").use { statement ->
            statement.setBytes(1, request.operationId.toUuidBytes())
            statement.executeQuery().use { result -> if (result.next()) result.getString(1) else null }
        }
        if (receipt != null) {
            if (receipt != request.fingerprint) throw invalidReplay()
            return StoredRecordAdmission(reader.loadWorkbookBundle(), true)
        }
        val endpoints = connection.prepareStatement("SELECT before_workbook, after_workbook FROM record_admissions WHERE sheet_id = ? AND row_id = ?").use { statement ->
            statement.setBytes(1, request.sheetId.value.toUuidBytes())
            statement.setBytes(2, request.rowId.value.toUuidBytes())
            statement.executeQuery().use { result ->
                if (!result.next()) throw invalidReplay()
                decode(result.getString(1)) to decode(result.getString(2))
            }
        }
        val current = reader.loadWorkbookBundle()
        guardRecordWorkbook(current, request.before)
        val (source, target) = if (request.direction == "undo") endpoints.second to endpoints.first else endpoints
        if (!sameWorkbookContent(current, source)) throw WorkbookApplicationException(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT)
        val restored = target.copy(
            manifest = target.manifest.copy(revision = current.manifest.revision),
            documents = target.documents.mapValues { (id, sheet) -> sheet.copy(revision = current.documents.getValue(id).revision) },
        )
        // Only immutable endpoints captured after valid admission authorize non-derivable calculated instances.
        SqliteWorkbookWriter(connection, reader).persistChanges(current, restored)
        connection.prepareStatement("INSERT INTO record_replays (operation_id, fingerprint) VALUES (?, ?)").use { statement ->
            statement.setBytes(1, request.operationId.toUuidBytes())
            statement.setString(2, request.fingerprint)
            statement.executeUpdate()
        }
        return StoredRecordAdmission(reader.loadWorkbookBundle(), false)
    }

    private fun decode(value: String) = Json.decodeFromString<WorkbookBundleResponse>(value).toLifecycleWorkbook()

    private fun invalidReplay() = WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_RECORD)
}
