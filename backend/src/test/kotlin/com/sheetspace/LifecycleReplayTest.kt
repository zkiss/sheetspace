package com.sheetspace

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class LifecycleReplayTest {
    @Test
    fun `replay fingerprints normalized authority and direction independently of operation identity`() {
        val transition = UUID.randomUUID().toString()
        val operation = UUID.randomUUID().toString()
        val prepared = prepareLifecycleReplay(transition, LifecycleReplayRequest(operation, "undo"))

        assertEquals(prepared.fingerprint, prepareLifecycleReplay(transition.uppercase(), LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).fingerprint)
        assertNotEquals(prepared.fingerprint, prepareLifecycleReplay(transition, LifecycleReplayRequest(operation, "redo")).fingerprint)
        assertNotEquals(prepared.fingerprint, prepareLifecycleReplay(UUID.randomUUID().toString(), LifecycleReplayRequest(operation, "undo")).fingerprint)
    }

    @Test
    fun `replay rejects malformed identities and directions`() {
        val id = UUID.randomUUID().toString()
        assertFailsWith<WorkbookApplicationException> { prepareLifecycleReplay("invalid", LifecycleReplayRequest(id, "undo")) }
        assertFailsWith<WorkbookApplicationException> { prepareLifecycleReplay(id, LifecycleReplayRequest("invalid", "undo")) }
        assertFailsWith<WorkbookApplicationException> { prepareLifecycleReplay(id, LifecycleReplayRequest(id, "UNDO")) }
    }
}
