package com.sheetspace

import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class SheetCreationReceiptTest {
    @Test
    fun `receipt retains transaction state despite a subsequent mutation`() {
        val backing = InMemoryWorkbookStore()
        var mutateAfterCommit = false
        val store = object : WorkbookStore by backing {
            override fun updateWorkbook(expectedRevision: ExpectedSheetRevision?, transform: (WorkbookState) -> WorkbookState): WorkbookState {
                val committed = backing.updateWorkbook(expectedRevision, transform)
                if (mutateAfterCommit) {
                    mutateAfterCommit = false
                    backing.updateWorkbook { it.copy(functions = emptyList()) }
                }
                return committed
            }
        }
        val app = DefaultWorkbookApplication(store)
        val target = app.createSheet(CreateSheetCommand("Target"))
        val initial = app.createSheet(CreateSheetCommand("Initial"))
        val definitions = listOf(
            CustomFunction("zero", emptyList(), "=@Target!A[1]"),
            CustomFunction("many", listOf(CustomFunctionParameter("x", "int"), CustomFunctionParameter("y", "string")), "=SUM(x,@A[1])"),
            CustomFunction("draft", emptyList(), "not a formula"),
        )
        definitions.forEach { app.setFunction(app.loadWorkbookBundle(), it, null) }
        val before = app.loadWorkbookBundle()
        mutateAfterCommit = true
        val receipt = app.createSheetWithReceipt(CreateSheetCommand("New"))
        val functions = receipt.workbook.functions
        assertEquals(definitions.map { it.body }, functions.map { it.body })
        assertEquals(before.functions.map { it.bodyBindings[initial.id.value] }, functions.map { it.bodyBindings[initial.id.value] })
        assertTrue(functions.first().bodyBindings.getValue(initial.id.value).contains(target.id.value))
        assertTrue(functions.take(2).all { receipt.sheetId.value in it.bodyBindings })
        assertTrue(functions.last().bodyBindings.isEmpty())
        assertEquals("New", receipt.workbook.documents.getValue(receipt.sheetId).name)
        assertNotEquals(receipt.workbook.functions, app.loadWorkbookBundle().functions)
        assertEquals(before.manifest.revision + 1, receipt.workbook.manifest.revision)
    }

    @Test
    fun `sqlite receipt matches durable reload and rejected creation leaves state unchanged`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val empty = app.createSheetWithReceipt(CreateSheetCommand("First"))
            assertTrue(empty.workbook.functions.isEmpty())
            app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@A[1]"), null)
            val receipt = app.createSheetWithReceipt(CreateSheetCommand("Second"))
            assertEquals(receipt.workbook, store.loadWorkbookBundle())
            assertFailsWith<WorkbookApplicationException> { app.createSheetWithReceipt(CreateSheetCommand("Second")) }
            assertEquals(receipt.workbook, store.loadWorkbookBundle())
        }
    }

    @Test
    fun `store failure does not return a creation receipt`() {
        val backing = InMemoryWorkbookStore()
        val store = object : WorkbookStore by backing {
            override fun updateWorkbook(expectedRevision: ExpectedSheetRevision?, transform: (WorkbookState) -> WorkbookState): WorkbookState {
                throw IllegalStateException("write failed")
            }
        }
        val before = backing.loadWorkbookBundle()
        assertFailsWith<IllegalStateException> { DefaultWorkbookApplication(store).createSheetWithReceipt(CreateSheetCommand("New")) }
        assertEquals(before, backing.loadWorkbookBundle())
    }

    @Test
    fun `http receipt contains created identity and complete committed bundle`() = testWorkbookApplication { app ->
        app.createSheet(CreateSheetCommand("Existing"))
        app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@A[1]"), null)
        val response = client.post("/api/sheets") { jsonBody("""{"name":"New"}""") }
        assertEquals(HttpStatusCode.Created, response.status)
        val receipt = response.decodeBody<SheetCreationResponse>()
        assertEquals("New", receipt.createdDocument().name)
        assertEquals(WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle()), receipt.workbook)
        assertTrue(receipt.workbook.functions.single().bodyBindings.containsKey(receipt.sheetId))
    }
}
