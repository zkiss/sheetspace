package com.sheetspace

import java.sql.DriverManager
import java.util.UUID

internal fun AtomicAdmissionScenario.replayRequest(direction: String) = RecordReplayRequest(
    UUID.randomUUID().toString(), direction, WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle()),
)

internal fun AtomicAdmissionScenario.replay(request: RecordReplayRequest): RecordReplayResult =
    app.replayRecord(target.id.value, row.value, request)

internal fun replayReceipts(store: SqliteWorkbookStore): Int = DriverManager.getConnection(store.jdbcUrl).use { connection ->
    connection.createStatement().use { statement -> statement.executeQuery("SELECT COUNT(*) FROM record_replays").use { result -> result.next(); result.getInt(1) } }
}
