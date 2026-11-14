package com.sheetspace

import java.sql.DriverManager
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FunctionReplayProvenanceBoundaryTest {
    private fun id() = UUID.randomUUID().toString()
    private fun bundle(app: DefaultWorkbookApplication) = WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle())
    private fun shadows(store: SqliteWorkbookStore) = DriverManager.getConnection(store.jdbcUrl).use { SqliteReplayBindingProvenance(it).all() }
    private fun removeCaller(app: DefaultWorkbookApplication, caller: SheetId): ModelLifecycleResponse {
        val before = app.loadWorkbookBundle()
        return app.saveModelLifecycle(ModelLifecycleRequest(id(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller))))
    }

    @Test
    fun `deleted column remains bound while new fragment captures edit time column`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = removeCaller(app, caller.id)
            val oldColumn = target.tabularContent.columns.first()
            val editColumn = target.tabularContent.columns[1]
            val replacement = ColumnId.generate()
            replaceColumns(store, target.id, listOf(replacement, editColumn) + target.tabularContent.columns.drop(2))
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@Target!A[1]+@Target!B[1]"), "f")
            val laterColumn = ColumnId.generate()
            replaceColumns(store, target.id, listOf(replacement, laterColumn) + target.tabularContent.columns.drop(2))
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(id(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(oldColumn.value), binding)
            assertTrue(binding.contains(editColumn.value), binding)
            assertTrue(binding.contains(target.tabularContent.rows.first().value), binding)
            assertFalse(binding.contains(replacement.value), binding)
            assertFalse(binding.contains(laterColumn.value), binding)
        }
    }

    @Test
    fun `deleted sheet reference remains bound while new fragment captures replacement at edit time`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val original = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            app.setFunction(app.loadWorkbookBundle(), declaration, null)
            store.updateWorkbook { it.removeSheet(original.id) }
            val replacement = app.createSheet(CreateSheetCommand("Target"))
            val retained = app.loadWorkbookBundle().functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(retained.contains(original.id.value), retained)
            assertTrue(retained.contains(original.tabularContent.rows.first().value), retained)
            assertTrue(retained.contains(original.tabularContent.columns.first().value), retained)
            assertFalse(retained.contains(replacement.id.value), retained)

            val transition = removeCaller(app, caller.id)
            val body = "=@Target!A[1]+@Target!B[1]"
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = body), "f")
            val editRow = replacement.tabularContent.rows.first()
            val editColumn = replacement.tabularContent.columns[1]
            val laterRow = RowId.generate()
            val laterColumn = ColumnId.generate()
            store.updateWorkbook { current ->
                val sheet = current.documents.getValue(replacement.id)
                val content = sheet.tabularContent
                current.replaceSheet(sheet.copy(content = TabularContent(listOf(laterRow) + content.rows.drop(1), listOf(content.columns.first(), laterColumn) + content.columns.drop(2), content.cellContents)))
            }
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(id(), "undo")).workbook.toLifecycleWorkbook()
            val function = restored.functions.single()
            val binding = function.bodyBindings.getValue(caller.id.value)
            assertEquals(body, function.body)
            assertTrue(binding.contains(original.id.value), binding)
            assertTrue(binding.contains(original.tabularContent.rows.first().value), binding)
            assertTrue(binding.contains(original.tabularContent.columns.first().value), binding)
            assertTrue(binding.contains(replacement.id.value), binding)
            assertTrue(binding.contains(editRow.value), binding)
            assertTrue(binding.contains(editColumn.value), binding)
            assertFalse(binding.contains(laterRow.value), binding)
            assertFalse(binding.contains(laterColumn.value), binding)
            assertFalse(restored.documents.containsKey(original.id))
            assertTrue(restored.documents.containsKey(replacement.id))
        }
    }

    @Test
    fun `rejected mutations and conflicting replay preserve shadows and remain retryable`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val stale = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = removeCaller(app, caller.id)
            val current = bundle(app)
            val savedShadows = shadows(store)
            val staleRequest = FunctionWriteRequest(id(), WorkbookReadTransportAdapter.bundle(stale), declaration.copy(body = "=@Target!A[1]+1"), "f")
            assertEquals(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT, assertFailsWith<WorkbookApplicationException> { app.admitFunctionWrite(staleRequest) }.error)
            assertEquals(current, bundle(app))
            assertEquals(savedShadows, shadows(store))
            val invalid = FunctionWriteRequest(id(), current, CustomFunction("sum", emptyList(), "=1"))
            assertEquals(WorkbookApplicationError.INVALID_FUNCTION, assertFailsWith<WorkbookApplicationException> { app.admitFunctionWrite(invalid) }.error)
            assertEquals(current, bundle(app))
            assertEquals(savedShadows, shadows(store))
            assertFalse(app.admitFunctionWrite(staleRequest.copy(before = current)).alreadyCommitted)
            assertFalse(app.admitFunctionWrite(invalid.copy(before = bundle(app), declaration = CustomFunction("g", emptyList(), "=1"))).alreadyCommitted)
            val beforeConflict = app.loadWorkbookBundle()
            store.updateWorkbook { it.replaceSheet(it.documents.getValue(target.id).rename("Caller")) }
            val conflicting = bundle(app)
            val conflictShadows = shadows(store)
            val replay = LifecycleReplayRequest(id(), "undo")
            val historyBefore = history(store)
            assertEquals(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT, assertFailsWith<WorkbookApplicationException> { app.replayLifecycle(transition.transitionId, replay) }.error)
            assertEquals(conflicting, bundle(app))
            assertEquals(conflictShadows, shadows(store))
            assertEquals(historyBefore, history(store))
            store.updateWorkbook { beforeConflict }
            val restored = app.replayLifecycle(transition.transitionId, replay)
            assertFalse(restored.alreadyCommitted)
            val binding = restored.workbook.toLifecycleWorkbook().functions.first { it.name == "f" }.bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(target.tabularContent.rows.first().value), binding)
            assertTrue(binding.contains(target.tabularContent.columns.first().value), binding)
        }
    }

    private fun replaceColumns(store: SqliteWorkbookStore, sheetId: SheetId, columns: List<ColumnId>) {
        store.updateWorkbook { current ->
            val sheet = current.documents.getValue(sheetId)
            val content = sheet.tabularContent
            current.replaceSheet(sheet.copy(content = TabularContent(content.rows, columns, content.cellContents)))
        }
    }

    private fun history(store: SqliteWorkbookStore): Pair<List<Int>, Int> = DriverManager.getConnection(store.jdbcUrl).use { connection ->
        val applied = connection.createStatement().use { statement -> statement.executeQuery("SELECT applied FROM lifecycle_transitions ORDER BY transition_id").use { result -> buildList { while (result.next()) add(result.getInt(1)) } } }
        val receipts = connection.createStatement().use { statement -> statement.executeQuery("SELECT count(*) FROM lifecycle_receipts").use { result -> result.next(); result.getInt(1) } }
        applied to receipts
    }
}
