package com.sheetspace

import java.util.UUID
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class FunctionReceiptTest {
    private fun id() = UUID.randomUUID().toString()
    private fun bundle(application: WorkbookApplication) = WorkbookReadTransportAdapter.bundle(application.loadWorkbookBundle())

    @Test
    fun `matching retries acknowledge each mutation without reapplying it`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            app.createSheet(CreateSheetCommand("Inputs"))
            val create = FunctionWriteRequest(id(), bundle(app), CustomFunction("f", emptyList(), "=1"))
            val first = app.admitFunctionWrite(create)
            assertFalse(first.alreadyCommitted)
            assertEquals(first.committedIdentity, first.workbook.functions.single().identity)
            assertEquals(first.copy(alreadyCommitted = true), app.admitFunctionWrite(create))
            val edit = FunctionWriteRequest(id(), first.workbook, CustomFunction("f", emptyList(), "=2"), "f")
            val edited = app.admitFunctionWrite(edit)
            assertNotEquals(first.committedIdentity, edited.committedIdentity)
            assertEquals(edited.copy(alreadyCommitted = true), app.admitFunctionWrite(edit))
            val rename = FunctionWriteRequest(id(), edited.workbook, CustomFunction("g", emptyList(), "=2"), "f")
            val renamed = app.admitFunctionWrite(rename)
            assertEquals(edited.committedIdentity, renamed.committedIdentity)
            assertEquals(renamed.copy(alreadyCommitted = true), app.admitFunctionWrite(rename))
            val delete = FunctionDeleteRequest(id(), renamed.workbook, "g")
            val deleted = app.admitFunctionDelete(delete)
            assertEquals(renamed.committedIdentity, deleted.committedIdentity)
            assertEquals(deleted.copy(alreadyCommitted = true), app.admitFunctionDelete(delete))
            val retry = app.admitFunctionWrite(create)
            assertEquals(first.committedIdentity, retry.committedIdentity)
            assertTrue(retry.alreadyCommitted)
            assertTrue(retry.workbook.functions.isEmpty())
        }
    }

    @Test
    fun `receipt survives reopen and intervening name reuse without overwriting current state`() {
        val path = tempSqlitePath()
        try {
            lateinit var request: FunctionWriteRequest
            lateinit var identity: String
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                request = FunctionWriteRequest(id(), bundle(app), CustomFunction("f", emptyList(), "=1"))
                val created = app.admitFunctionWrite(request)
                identity = created.committedIdentity
                app.admitFunctionDelete(FunctionDeleteRequest(id(), created.workbook, "f"))
                app.admitFunctionWrite(FunctionWriteRequest(id(), bundle(app), request.declaration))
                app.createSheet(CreateSheetCommand("Later"))
            }
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                val current = bundle(app)
                val retry = app.admitFunctionWrite(request)
                assertTrue(retry.alreadyCommitted)
                assertEquals(identity, retry.committedIdentity)
                assertNotEquals(identity, retry.workbook.functions.single().identity)
                assertEquals(current, retry.workbook)
                assertFailsWith<WorkbookApplicationException> { app.admitFunctionWrite(request.copy(declaration = request.declaration.copy(body = "=2"))) }
                assertFailsWith<WorkbookApplicationException> { app.admitFunctionDelete(FunctionDeleteRequest(request.operationId, request.before, "f")) }
                assertFailsWith<WorkbookApplicationException> { app.admitFunctionWrite(request.copy(operationId = id())) }
                assertEquals(current, bundle(app))
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }

    @Test
    fun `retrying an edit after rename and another edit preserves the current workbook`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            app.admitFunctionWrite(FunctionWriteRequest(id(), bundle(app), CustomFunction("f", emptyList(), "=1")))
            val edit = FunctionWriteRequest(id(), bundle(app), CustomFunction("f", emptyList(), "=2"), "f")
            val committed = app.admitFunctionWrite(edit)
            app.admitFunctionWrite(FunctionWriteRequest(id(), bundle(app), CustomFunction("g", emptyList(), "=2"), "f"))
            app.admitFunctionWrite(FunctionWriteRequest(id(), bundle(app), CustomFunction("g", emptyList(), "=3"), "g"))
            val current = bundle(app)

            val retry = app.admitFunctionWrite(edit)
            assertTrue(retry.alreadyCommitted)
            assertEquals(committed.committedIdentity, retry.committedIdentity)
            assertEquals(current, retry.workbook)
            assertEquals(current, bundle(app))
        }
    }

    @Test
    fun `retrying a rename after deletion and name reuse preserves the replacement`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            app.admitFunctionWrite(FunctionWriteRequest(id(), bundle(app), CustomFunction("f", emptyList(), "=1")))
            val rename = FunctionWriteRequest(id(), bundle(app), CustomFunction("g", emptyList(), "=1"), "f")
            val committed = app.admitFunctionWrite(rename)
            app.admitFunctionDelete(FunctionDeleteRequest(id(), bundle(app), "g"))
            val replacement = app.admitFunctionWrite(FunctionWriteRequest(id(), bundle(app), CustomFunction("g", emptyList(), "=4")))
            val current = bundle(app)

            val retry = app.admitFunctionWrite(rename)
            assertTrue(retry.alreadyCommitted)
            assertEquals(committed.committedIdentity, retry.committedIdentity)
            assertNotEquals(replacement.committedIdentity, retry.committedIdentity)
            assertEquals(current, retry.workbook)
            assertEquals(current, bundle(app))
        }
    }

    @Test
    fun `retrying a delete after name reuse and unrelated write preserves the replacement`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val created = app.admitFunctionWrite(FunctionWriteRequest(id(), bundle(app), CustomFunction("f", emptyList(), "=1")))
            val delete = FunctionDeleteRequest(id(), bundle(app), "f")
            val committed = app.admitFunctionDelete(delete)
            val replacement = app.admitFunctionWrite(FunctionWriteRequest(id(), bundle(app), CustomFunction("f", emptyList(), "=2")))
            app.createSheet(CreateSheetCommand("Later"))
            val current = bundle(app)

            val retry = app.admitFunctionDelete(delete)
            assertTrue(retry.alreadyCommitted)
            assertEquals(created.committedIdentity, committed.committedIdentity)
            assertEquals(committed.committedIdentity, retry.committedIdentity)
            assertNotEquals(replacement.committedIdentity, retry.committedIdentity)
            assertEquals(current, retry.workbook)
            assertEquals(current, bundle(app))
        }
    }

    @Test
    fun `changed precondition is rejected for a committed operation and stale conflict leaves no receipt`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val before = bundle(app)
            val request = FunctionWriteRequest(id(), before, CustomFunction("f", emptyList(), "=1"))
            val committed = app.admitFunctionWrite(request)
            val mismatch = assertFailsWith<WorkbookApplicationException> { app.admitFunctionWrite(request.copy(before = committed.workbook)) }
            assertEquals(WorkbookApplicationError.INVALID_FUNCTION, mismatch.error)
            assertEquals(committed.workbook, bundle(app))

            val stale = FunctionWriteRequest(id(), before, CustomFunction("g", emptyList(), "=2"))
            val conflict = assertFailsWith<WorkbookApplicationException> { app.admitFunctionWrite(stale) }
            assertEquals(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT, conflict.error)
            assertEquals(committed.workbook, bundle(app))
            val accepted = app.admitFunctionWrite(stale.copy(before = committed.workbook))
            assertFalse(accepted.alreadyCommitted)
            assertEquals(2, accepted.workbook.functions.size)
        }
    }

    @Test
    fun `rejected and failed mutations leave no receipts`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val before = bundle(app)
            val operation = id()
            val invalid = FunctionWriteRequest(operation, before, CustomFunction("sum", emptyList(), "=1"))
            assertFailsWith<WorkbookApplicationException> { app.admitFunctionWrite(invalid) }
            assertEquals(before, bundle(app))
            val valid = invalid.copy(declaration = CustomFunction("ok", emptyList(), "=1"))
            assertFalse(app.admitFunctionWrite(valid).alreadyCommitted)
            val failed = PreparedFunctionMutation(id(), "fingerprint")
            assertFailsWith<IllegalStateException> { store.admitFunction(failed) { error("failure") } }
            assertFalse(store.admitFunction(failed) { FunctionMutationResult(it, "identity") }.alreadyCommitted)
        }
    }

    @Test
    fun `receipt insertion failure rolls back the function write`() {
        val path = tempSqlitePath()
        try {
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                val request = FunctionWriteRequest(id(), bundle(app), CustomFunction("f", emptyList(), "=1"))
                DriverManager.getConnection(store.jdbcUrl).use { connection ->
                    connection.createStatement().use { it.execute("CREATE TRIGGER fail_function_receipt BEFORE INSERT ON function_receipts BEGIN SELECT RAISE(ABORT, 'injected'); END") }
                }
                assertFailsWith<Exception> { app.admitFunctionWrite(request) }
                assertEquals(request.before, bundle(app))
                DriverManager.getConnection(store.jdbcUrl).use { connection ->
                    connection.createStatement().use { it.execute("DROP TRIGGER fail_function_receipt") }
                }
                assertFalse(app.admitFunctionWrite(request).alreadyCommitted)
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }
}
