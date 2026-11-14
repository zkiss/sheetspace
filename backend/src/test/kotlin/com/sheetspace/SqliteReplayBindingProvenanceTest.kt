package com.sheetspace

import java.sql.DriverManager
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SqliteReplayBindingProvenanceTest {
    @Test
    fun `capture seeds callers from either endpoint without changing endpoints`() {
        val path = tempSqlitePath()
        try {
            SqliteWorkbookStore(path).close()
            val before = extractionWorkbook()
            val after = extractedFrom(before)
            val definition = CustomFunction("f", emptyList(), "draft", identity = UUID.randomUUID().toString())
            val left = before.copy(functions = listOf(definition))
            val right = after.copy(functions = listOf(definition))
            DriverManager.getConnection("jdbc:sqlite:${path.toAbsolutePath()}").use { connection ->
                val history = SqliteLifecycleHistory(connection, SqliteWorkbookReader(connection))
                for ((first, second) in listOf(left to right, right to left)) {
                    val transition = history.capture(UUID.randomUUID().toString(), UUID.randomUUID().toString(), first, second).transitionId
                    val states = SqliteReplayBindingProvenance(connection).list(transition)
                    val expected = (first.documents.keys - second.documents.keys) + (second.documents.keys - first.documents.keys)
                    assertEquals(expected.map { it.value }.toSet(), states.map { it.caller.id }.toSet())
                    assertEquals(second to first, history.endpoints(PreparedLifecycleReplay(UUID.randomUUID().toString(), transition, "undo", "fingerprint")))
                }
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }

    @Test
    fun `private transition state survives reopen and rolls back with its caller transaction`() {
        val path = tempSqlitePath()
        val transition = UUID.randomUUID().toString()
        val caller = WorkbookReadTransportAdapter.bundle(extractionWorkbook()).documents.first()
        val definition = CustomFunction("f", emptyList(), "=@A[1]", identity = UUID.randomUUID().toString())
        val state = ReplayBindingProvenance(caller, definition, "binding")
        try {
            SqliteWorkbookStore(path).close()
            DriverManager.getConnection("jdbc:sqlite:${path.toAbsolutePath()}").use { connection ->
                connection.prepareStatement("INSERT INTO lifecycle_transitions VALUES (?, '{}', '{}', 1)").use {
                    it.setBytes(1, transition.toUuidBytes())
                    it.executeUpdate()
                }
                SqliteReplayBindingProvenance(connection).put(transition, state)
            }
            DriverManager.getConnection("jdbc:sqlite:${path.toAbsolutePath()}").use { connection ->
                val history = SqliteReplayBindingProvenance(connection)
                assertEquals(listOf(state), history.list(transition))
                assertEquals(listOf(transition to state), history.all())
                connection.autoCommit = false
                val next = state.copy(declaration = definition.copy(identity = UUID.randomUUID().toString(), body = "draft"), binding = null)
                history.advance(transition, state, next)
                assertNull(history.list(transition).single().binding)
                connection.rollback()
                assertEquals(listOf(state), history.list(transition))
                val reset = state.copy(declaration = definition.copy(parameters = listOf(CustomFunctionParameter("x", "int"))))
                history.advance(transition, state, reset)
                assertEquals(emptyList(), history.list(transition))
                connection.rollback()
                history.advance(transition, state, null)
                connection.commit()
                assertEquals(emptyList(), history.list(transition))
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }
}
