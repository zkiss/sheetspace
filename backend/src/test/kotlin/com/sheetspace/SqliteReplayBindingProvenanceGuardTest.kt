package com.sheetspace

import java.sql.DriverManager
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class SqliteReplayBindingProvenanceGuardTest {
    @Test
    fun `mutation advances only matching source and discards stale state`() = withHistory { history, transition ->
        val app = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val a = app.createSheet(CreateSheetCommand("A"))
        val b = app.createSheet(CreateSheetCommand("B"))
        val current = app.loadWorkbookBundle()
        val documents = WorkbookReadTransportAdapter.bundle(current).documents.associateBy { it.id }
        val f = CustomFunction("f", emptyList(), "draft", identity = UUID.randomUUID().toString())
        val g = f.copy(name = "g", identity = UUID.randomUUID().toString())
        val valid = ReplayBindingProvenance(documents.getValue(a.id.value), f, "old")
        val stale = ReplayBindingProvenance(documents.getValue(b.id.value), f.copy(body = "stale"), "stale")
        val unrelated = ReplayBindingProvenance(documents.getValue(a.id.value), g, "other")
        listOf(valid, stale, unrelated).forEach { history.put(transition, it) }
        val next = f.copy(body = "new", identity = UUID.randomUUID().toString(), bodyBindings = mapOf(a.id.value to "new binding"))

        history.advanceMutation(current, FunctionMutationResult(current, next.identity, f, next))

        assertEquals(setOf(unrelated, valid.copy(declaration = next.copy(bodyBindings = emptyMap()), binding = "new binding")), history.list(transition).toSet())
    }

    @Test
    fun `refresh removes invalid sources and leaves unrelated callers unchanged`() = withHistory { history, transition ->
        val app = DefaultWorkbookApplication(InMemoryWorkbookStore())
        val a = app.createSheet(CreateSheetCommand("A"))
        val b = app.createSheet(CreateSheetCommand("B"))
        val base = app.loadWorkbookBundle()
        val documents = WorkbookReadTransportAdapter.bundle(base).documents.associateBy { it.id }
        val f = CustomFunction("f", emptyList(), "draft", identity = UUID.randomUUID().toString(), bodyBindings = mapOf(a.id.value to "actual"))
        val missing = f.copy(name = "missing", identity = UUID.randomUUID().toString())
        val blank = f.copy(name = "blank", identity = "")
        val stale = f.copy(name = "stale", identity = UUID.randomUUID().toString())
        val current = base.copy(functions = listOf(f.copy(name = "other", identity = UUID.randomUUID().toString()), f, blank, stale))
        val valid = ReplayBindingProvenance(documents.getValue(a.id.value), f.copy(bodyBindings = emptyMap()), "old")
        val untouched = ReplayBindingProvenance(documents.getValue(b.id.value), f.copy(bodyBindings = emptyMap()), "untouched")
        listOf(valid, untouched, valid.copy(declaration = missing), valid.copy(declaration = blank), valid.copy(declaration = stale.copy(body = "old"))).forEach { history.put(transition, it) }

        history.refreshRemoved(current, setOf(a.id))

        assertEquals(setOf(untouched, valid.copy(binding = "actual")), history.list(transition).toSet())
    }

    @Test
    fun `advance to a different caller removes the old state without inserting another`() = withHistory { history, transition ->
        val app = DefaultWorkbookApplication(InMemoryWorkbookStore())
        app.createSheet(CreateSheetCommand("A"))
        app.createSheet(CreateSheetCommand("B"))
        val documents = WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle()).documents
        val state = ReplayBindingProvenance(documents[0], CustomFunction("f", emptyList(), "draft", identity = UUID.randomUUID().toString()), null)
        history.put(transition, state)

        history.advance(transition, state, state.copy(caller = documents[1]))

        assertEquals(emptyList(), history.list(transition))
    }

    private fun withHistory(block: (SqliteReplayBindingProvenance, String) -> Unit) {
        val path = tempSqlitePath()
        try {
            SqliteWorkbookStore(path).close()
            DriverManager.getConnection("jdbc:sqlite:${path.toAbsolutePath()}").use { connection ->
                val transition = UUID.randomUUID().toString()
                val empty = Json.encodeToString(WorkbookReadTransportAdapter.bundle(DefaultWorkbookApplication(InMemoryWorkbookStore()).loadWorkbookBundle()))
                connection.prepareStatement("INSERT INTO lifecycle_transitions VALUES (?, ?, ?, 1)").use {
                    it.setBytes(1, transition.toUuidBytes())
                    it.setString(2, empty)
                    it.setString(3, empty)
                    it.executeUpdate()
                }
                block(SqliteReplayBindingProvenance(connection), transition)
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }
}
