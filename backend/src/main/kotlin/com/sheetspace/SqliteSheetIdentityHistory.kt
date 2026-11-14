package com.sheetspace

import java.sql.Connection

internal class SqliteSheetIdentityHistory(private val connection: Connection) {
    fun reconcile(current: Set<SheetId>, updated: Set<SheetId>, restored: Set<SheetId> = emptySet()) {
        (updated - current).forEach { id ->
            val exists = connection.prepareStatement("SELECT 1 FROM sheet_identity_history WHERE sheet_id = ?").use { statement ->
                statement.setBytes(1, id.value.toUuidBytes())
                statement.executeQuery().use { it.next() }
            }
            if (exists && id in restored) {
                connection.prepareStatement("UPDATE sheet_identity_history SET retired = 0 WHERE sheet_id = ? AND retired = 1").use { statement ->
                    statement.setBytes(1, id.value.toUuidBytes())
                    if (statement.executeUpdate() != 1) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
                }
                return@forEach
            }
            if (exists || id in restored) throw WorkbookApplicationException(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE)
            connection.prepareStatement("INSERT INTO sheet_identity_history (sheet_id, retired) VALUES (?, 0)").use { statement ->
                statement.setBytes(1, id.value.toUuidBytes())
                statement.executeUpdate()
            }
        }
        (current - updated).forEach { id ->
            connection.prepareStatement("UPDATE sheet_identity_history SET retired = 1 WHERE sheet_id = ?").use { statement ->
                statement.setBytes(1, id.value.toUuidBytes())
                statement.executeUpdate()
            }
        }
    }
}
