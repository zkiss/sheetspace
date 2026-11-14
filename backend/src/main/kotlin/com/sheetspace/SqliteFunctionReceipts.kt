package com.sheetspace

import java.sql.Connection

internal class SqliteFunctionReceipts(private val connection: Connection, private val reader: SqliteWorkbookReader) {
    fun receipt(request: PreparedFunctionMutation): StoredFunctionMutation? =
        connection.prepareStatement("SELECT fingerprint, committed_identity FROM function_receipts WHERE operation_id = ?").use { statement ->
            statement.setBytes(1, request.operationId.toUuidBytes())
            statement.executeQuery().use { result ->
                if (!result.next()) return null
                if (result.getString(1) != request.fingerprint) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_FUNCTION)
                StoredFunctionMutation(reader.loadWorkbookBundle(), result.getString(2), true)
            }
        }

    fun capture(request: PreparedFunctionMutation, identity: String): StoredFunctionMutation {
        connection.prepareStatement("INSERT INTO function_receipts (operation_id, fingerprint, committed_identity) VALUES (?, ?, ?)").use { statement ->
            statement.setBytes(1, request.operationId.toUuidBytes())
            statement.setString(2, request.fingerprint)
            statement.setString(3, identity)
            statement.executeUpdate()
        }
        return StoredFunctionMutation(reader.loadWorkbookBundle(), identity, false)
    }
}
