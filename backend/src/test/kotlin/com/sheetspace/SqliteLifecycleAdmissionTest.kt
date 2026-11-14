package com.sheetspace

import java.util.UUID
import java.sql.DriverManager
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class SqliteLifecycleAdmissionTest {
    @Test
    fun `admission fingerprint rejects malformed operation and malformed snapshots`() {
        val bundle = WorkbookReadTransportAdapter.bundle(extractionWorkbook())
        assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, assertFailsWith<WorkbookApplicationException> {
            prepareLifecycleAdmission("invalid", bundle, bundle)
        }.error)
        val malformed = bundle.copy(manifest = bundle.manifest.copy(sheetIds = emptyList()))
        assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, assertFailsWith<WorkbookApplicationException> {
            prepareLifecycleAdmission(UUID.randomUUID().toString(), malformed, bundle)
        }.error)
    }

    @Test
    fun `admission captures persisted state and receipt survives reopen`() {
        val path = tempSqlitePath()
        val before = extractionWorkbook()
        val after = extractedFrom(before)
        val request = prepareLifecycleAdmission(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(after))
        try {
            val admitted = SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(before)
                store.admitLifecycle(request) { reconcileModelLifecycle(it, request.before, request.after) }
            }
            assertFalse(admitted.alreadyCommitted)
            assertNotEquals(request.operationId, admitted.transitionId)
            DriverManager.getConnection("jdbc:sqlite:${path.toAbsolutePath()}").use { connection ->
                connection.createStatement().use { statement ->
                    statement.executeQuery("SELECT before_workbook, after_workbook, applied FROM lifecycle_transitions").use { rows ->
                        assertTrue(rows.next())
                        assertEquals(before, Json.decodeFromString<WorkbookBundleResponse>(rows.getString(1)).toLifecycleWorkbook())
                        assertEquals(admitted.workbook, Json.decodeFromString<WorkbookBundleResponse>(rows.getString(2)).toLifecycleWorkbook())
                        assertEquals(1, rows.getInt(3))
                        assertFalse(rows.next())
                    }
                }
            }
            SqliteWorkbookStore(path).use { store ->
                val retry = store.admitLifecycle(request) { error("receipt must precede transform") }
                assertTrue(retry.alreadyCommitted)
                assertEquals(admitted.transitionId, retry.transitionId)
                assertEquals(admitted.workbook, retry.workbook)
                val altered = request.copy(fingerprint = "different")
                assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, assertFailsWith<WorkbookApplicationException> {
                    store.admitLifecycle(altered) { error("mismatched receipt must reject") }
                }.error)
                assertEquals(admitted.workbook, store.loadWorkbookBundle())
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }
}
