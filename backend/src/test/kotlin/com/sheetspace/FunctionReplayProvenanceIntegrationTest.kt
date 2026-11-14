package com.sheetspace

import java.util.UUID
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith

class FunctionReplayProvenanceIntegrationTest {
    @Test
    fun `two absent callers use their own local context and current qualified name`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val first = app.createSheet(CreateSheetCommand("First"))
            val second = app.createSheet(CreateSheetCommand("Second"))
            val replacement = app.createSheet(CreateSheetCommand("Replacement"))
            val declaration = CustomFunction("f", emptyList(), "=@A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val removed = before.removeSheet(first.id).removeSheet(second.id)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(removed)))
            store.updateWorkbook { current -> current.replaceSheet(current.documents.getValue(replacement.id).rename("First")) }
            val editRow = RowId.generate()
            prependRow(store, replacement.id, editRow)
            val edited = app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@A[1]+@First!A[1]"), "f")
            assertEquals(setOf(replacement.id.value), edited.functions.single().bodyBindings.keys)
            prependRow(store, replacement.id, RowId.generate())
            store.updateWorkbook { current -> current.replaceSheet(current.documents.getValue(replacement.id).rename("Replacement")) }

            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            for (caller in listOf(first, second)) {
                val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
                assertTrue(binding.contains(caller.tabularContent.rows.first().value), binding)
                assertTrue(binding.contains("@${replacement.id.value}!"), binding)
                assertTrue(binding.contains(editRow.value), binding)
            }
        }
    }

    @Test
    fun `duplicate replay after another removal and edit does not rewind provenance`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            val undo = LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")
            app.replayLifecycle(transition.transitionId, undo)
            app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "redo"))
            val editRow = RowId.generate()
            prependRow(store, target.id, editRow)
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@Target!A[2]"), "f")
            val snapshot = WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle())
            val shadows = DriverManager.getConnection(store.jdbcUrl).use { SqliteReplayBindingProvenance(it).all() }

            assertTrue(app.replayLifecycle(transition.transitionId, undo).alreadyCommitted)
            assertEquals(snapshot, WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle()))
            assertEquals(shadows, DriverManager.getConnection(store.jdbcUrl).use { SqliteReplayBindingProvenance(it).all() })

            prependRow(store, target.id, RowId.generate())
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(target.tabularContent.rows.first().value), binding)
            assertTrue(!binding.contains(editRow.value), binding)
        }
    }

    @Test
    fun `invalid formula correction retains reference identity across absent caller replay`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            val inserted = RowId.generate()
            prependRow(store, target.id, inserted)
            val invalid = "=@Target!A[1]+"
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = invalid), "f")
            val restoredInvalid = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            assertEquals(invalid, restoredInvalid.functions.single().body)
            val invalidBinding = restoredInvalid.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(invalidBinding.contains(target.tabularContent.rows.first().value), invalidBinding)
            app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "redo"))
            val corrected = "=@Target!A[1]+1"
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = corrected), "f")
            val later = RowId.generate()
            prependRow(store, target.id, later)
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertEquals(corrected, restored.functions.single().body)
            assertTrue(binding.contains(target.tabularContent.rows.first().value), binding)
            assertTrue(!binding.contains(inserted.value) && !binding.contains(later.value), binding)
        }
    }

    @Test
    fun `overlapping removals refresh older transition from live caller binding`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val first = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            app.replayLifecycle(first.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo"))
            val liveRow = RowId.generate()
            prependRow(store, target.id, liveRow)
            val edited = app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@Target!A[2]"), "f")
            val second = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(edited), WorkbookReadTransportAdapter.bundle(edited.removeSheet(caller.id))))
            prependRow(store, target.id, RowId.generate())
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@Target!A[2]+1"), "f")
            app.replayLifecycle(second.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo"))
            app.replayLifecycle(first.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "redo"))
            val restored = app.replayLifecycle(first.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(target.tabularContent.rows.first().value), binding)
            assertTrue(!binding.contains(liveRow.value), binding)
        }
    }

    @Test
    fun `retained deleted target stays missing when a replacement row occupies its position`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val original = target.tabularContent.rows.first()
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            val replacement = RowId.generate()
            store.updateWorkbook { current ->
                val sheet = current.documents.getValue(target.id)
                val content = sheet.tabularContent
                current.replaceSheet(sheet.copy(content = TabularContent(listOf(replacement) + content.rows.drop(1), content.columns, content.cellContents)))
            }
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@Target!A[1]+1"), "f")
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(original.value), binding)
            assertTrue(!binding.contains(replacement.value), binding)
        }
    }

    @Test
    fun `undoing creation and redoing it restores edited absent caller provenance`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val caller = DefaultWorkbookApplication(InMemoryWorkbookStore()).createSheet(CreateSheetCommand("Caller"))
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.addSheet(caller))))
            app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo"))
            val inserted = RowId.generate()
            prependRow(store, target.id, inserted)
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@Target!A[1]+1"), "f")
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "redo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(target.tabularContent.rows.first().value), binding)
            assertTrue(!binding.contains(inserted.value), binding)
        }
    }

    @Test
    fun `failed replay receipt rolls back removal and its binding refresh`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo"))
            val editRow = RowId.generate()
            prependRow(store, target.id, editRow)
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@Target!A[2]"), "f")
            val liveBinding = app.loadWorkbookBundle().functions.single().bodyBindings.getValue(caller.id.value)
            DriverManager.getConnection(store.jdbcUrl).use { connection ->
                val provenance = SqliteReplayBindingProvenance(connection)
                val shadow = provenance.list(transition.transitionId).single()
                provenance.put(transition.transitionId, shadow.copy(binding = "deliberately divergent"))
            }
            val snapshot = WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle())
            val shadows = DriverManager.getConnection(store.jdbcUrl).use { SqliteReplayBindingProvenance(it).all() }
            fun history(): Pair<Int, Int> = DriverManager.getConnection(store.jdbcUrl).use { connection ->
                val applied = connection.createStatement().use { statement -> statement.executeQuery("SELECT applied FROM lifecycle_transitions").use { result -> result.next(); result.getInt(1) } }
                val receipts = connection.createStatement().use { statement -> statement.executeQuery("SELECT count(*) FROM lifecycle_receipts").use { result -> result.next(); result.getInt(1) } }
                applied to receipts
            }
            val initialHistory = history()
            val redo = LifecycleReplayRequest(UUID.randomUUID().toString(), "redo")
            DriverManager.getConnection(store.jdbcUrl).use { connection ->
                connection.createStatement().use { it.execute("CREATE TRIGGER fail_replay_receipt BEFORE INSERT ON lifecycle_receipts BEGIN SELECT RAISE(ABORT, 'injected'); END") }
            }
            assertFailsWith<Exception> { app.replayLifecycle(transition.transitionId, redo) }
            assertEquals(snapshot, WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle()))
            assertEquals(shadows, DriverManager.getConnection(store.jdbcUrl).use { SqliteReplayBindingProvenance(it).all() })
            assertEquals(initialHistory, history())
            DriverManager.getConnection(store.jdbcUrl).use { connection ->
                connection.createStatement().use { it.execute("DROP TRIGGER fail_replay_receipt") }
            }
            app.replayLifecycle(transition.transitionId, redo)
            val refreshed = DriverManager.getConnection(store.jdbcUrl).use { SqliteReplayBindingProvenance(it).list(transition.transitionId).single() }
            assertEquals(liveBinding, refreshed.binding)
            assertEquals(snapshot.documents.single { it.id == caller.id.value }, refreshed.caller)
            assertEquals(1 to initialHistory.second + 1, history())
            val afterRedo = WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle())
            assertTrue(afterRedo.documents.none { it.id == caller.id.value })
            assertTrue(app.replayLifecycle(transition.transitionId, redo).alreadyCommitted)
            assertEquals(afterRedo, WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle()))
            assertEquals(refreshed, DriverManager.getConnection(store.jdbcUrl).use { SqliteReplayBindingProvenance(it).list(transition.transitionId).single() })
            assertEquals(1 to initialHistory.second + 1, history())
            prependRow(store, target.id, RowId.generate())
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@Target!A[2]+1"), "f")
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(target.tabularContent.rows.first().value), binding)
            assertTrue(!binding.contains(editRow.value), binding)
        }
    }

    @Test
    fun `absent local caller retains its own identity alongside qualified target`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val other = app.createSheet(CreateSheetCommand("Other"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@A[1]+@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            val inserted = RowId.generate()
            prependRow(store, target.id, inserted)
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@A[1]+@Target!A[1]+1"), "f")
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val function = restored.functions.single()
            val local = function.bodyBindings.getValue(caller.id.value)
            val otherBinding = function.bodyBindings.getValue(other.id.value)
            assertTrue(local.contains(caller.tabularContent.rows.first().value), local)
            assertTrue(!local.contains(other.tabularContent.rows.first().value), local)
            assertTrue(otherBinding.contains(other.tabularContent.rows.first().value), otherBinding)
            assertTrue(local.contains(target.tabularContent.rows.first().value), local)
            assertTrue(!local.contains(inserted.value), local)
        }
    }

    @Test
    fun `failed function receipt rolls back absent caller provenance across restart`() {
        val path = tempSqlitePath()
        try {
            lateinit var transitionId: String
            lateinit var callerId: String
            lateinit var originalRow: String
            lateinit var editRow: String
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                val caller = app.createSheet(CreateSheetCommand("Caller"))
                callerId = caller.id.value
                val target = app.createSheet(CreateSheetCommand("Target"))
                originalRow = target.tabularContent.rows.first().value
                val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
                val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
                transitionId = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id)))).transitionId
                val inserted = RowId.generate()
                editRow = inserted.value
                prependRow(store, target.id, inserted)
                val request = FunctionWriteRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle()), declaration.copy(body = "=@Target!A[2]"), "f")
                DriverManager.getConnection(store.jdbcUrl).use { connection ->
                    connection.createStatement().use { it.execute("CREATE TRIGGER fail_function_receipt BEFORE INSERT ON function_receipts BEGIN SELECT RAISE(ABORT, 'injected'); END") }
                }
                assertFailsWith<Exception> { app.admitFunctionWrite(request) }
                assertEquals(request.before, WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle()))
                DriverManager.getConnection(store.jdbcUrl).use { connection ->
                    connection.createStatement().use { it.execute("DROP TRIGGER fail_function_receipt") }
                }
                app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "=@Target!A[1] + 1"), "f")
            }
            SqliteWorkbookStore(path).use { store ->
                val app = DefaultWorkbookApplication(store)
                val restored = app.replayLifecycle(transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
                val binding = restored.functions.single().bodyBindings.getValue(callerId)
                assertTrue(binding.contains(originalRow), binding)
                assertTrue(!binding.contains(editRow), binding)
            }
        } finally {
            deleteSqliteArtifacts(path)
        }
    }

    @Test
    fun `restoring raw body has no bindings and subsequent correction uses edit time target`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            val raw = "  unfinished text  "
            val absent = app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = raw), "f")
            assertTrue(caller.id.value !in absent.functions.single().bodyBindings)

            val restoredRaw = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            assertEquals(raw, restoredRaw.functions.single().body)
            assertEquals(emptyMap(), restoredRaw.functions.single().bodyBindings)

            app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "redo"))
            val editRow = RowId.generate()
            prependRow(store, target.id, editRow)
            app.setFunction(app.loadWorkbookBundle(), declaration, "f")
            val laterRow = RowId.generate()
            prependRow(store, target.id, laterRow)
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertEquals(declaration.body, restored.functions.single().body)
            assertTrue(binding.contains(editRow.value), binding)
            assertTrue(!binding.contains(laterRow.value), binding)
        }
    }

    @Test
    fun `raw body clears old bindings and correction binds in the current context`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            app.setFunction(app.loadWorkbookBundle(), declaration.copy(body = "not a formula"), "f")
            val row = RowId.generate()
            prependRow(store, target.id, row)
            app.setFunction(app.loadWorkbookBundle(), declaration, "f")
            prependRow(store, target.id, RowId.generate())
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val function = restored.functions.single()
            val binding = function.bodyBindings.getValue(caller.id.value)
            assertEquals(declaration.body, function.body)
            assertTrue(binding.contains(row.value), binding)
            assertTrue(!binding.contains(target.tabularContent.rows.first().value), binding)
        }
    }

    @Test
    fun `retrying a function receipt after another edit does not rewind absent caller lineage`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
            val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            val request = FunctionWriteRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(app.loadWorkbookBundle()), declaration.copy(body = "=@Target!A[2]"), "f")
            app.admitFunctionWrite(request)
            val row = RowId.generate()
            prependRow(store, target.id, row)
            app.setFunction(app.loadWorkbookBundle(), declaration, "f")
            assertTrue(app.admitFunctionWrite(request).alreadyCommitted)
            prependRow(store, target.id, RowId.generate())
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(row.value), binding)
            assertTrue(!binding.contains(target.tabularContent.rows.first().value), binding)
        }
    }

    @Test
    fun `repeated removal refreshes the caller binding after a live edit`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val originalRow = target.tabularContent.rows.first()
            val before = app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[1]"), null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo"))
            val liveRow = RowId.generate()
            prependRow(store, target.id, liveRow)
            app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[2]"), "f")
            app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "redo"))
            prependRow(store, target.id, RowId.generate())
            app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[2]+1"), "f")
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(originalRow.value), binding)
            assertTrue(!binding.contains(liveRow.value), binding)
        }
    }

    @Test
    fun `changed reference binds at edit time while retained reference keeps its identity`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val originalRow = target.tabularContent.rows.first()
            val before = app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[1]+@Target!A[1]"), null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            val editRow = RowId.generate()
            prependRow(store, target.id, editRow)
            prependRow(store, target.id, RowId.generate())
            app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[1]+@Target!A[2]"), "f")
            val laterRow = RowId.generate()
            prependRow(store, target.id, laterRow)
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(originalRow.value), binding)
            assertTrue(binding.contains(editRow.value), binding)
            assertTrue(!binding.contains(laterRow.value), binding)
        }
    }

    @Test
    fun `editing away and back binds the returned reference at the last edit`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val app = DefaultWorkbookApplication(store)
            val caller = app.createSheet(CreateSheetCommand("Caller"))
            val target = app.createSheet(CreateSheetCommand("Target"))
            val originalRow = target.tabularContent.rows.first()
            val before = app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[1]"), null)
            val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
            val intermediateRow = RowId.generate()
            prependRow(store, target.id, intermediateRow)
            app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[2]"), "f")
            val lastRow = RowId.generate()
            prependRow(store, target.id, lastRow)
            app.setFunction(app.loadWorkbookBundle(), CustomFunction("f", emptyList(), "=@Target!A[1]"), "f")
            val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
            val binding = restored.functions.single().bodyBindings.getValue(caller.id.value)
            assertTrue(binding.contains(lastRow.value), binding)
            assertTrue(!binding.contains(originalRow.value), binding)
            assertTrue(!binding.contains(intermediateRow.value), binding)
        }
    }

    private fun prependRow(store: SqliteWorkbookStore, sheetId: SheetId, row: RowId) {
        store.updateWorkbook { current ->
            val sheet = current.documents.getValue(sheetId)
            val content = sheet.tabularContent
            current.replaceSheet(sheet.copy(content = TabularContent(listOf(row) + content.rows, content.columns, content.cellContents)))
        }
    }

    @Test
    fun `fixed reference survives direct and receipted edits across removal and structural changes`() {
        for (receipted in listOf(false, true)) {
            SqliteWorkbookStore.inMemory().use { store ->
                val app = DefaultWorkbookApplication(store)
                val caller = app.createSheet(CreateSheetCommand("Caller"))
                val target = app.createSheet(CreateSheetCommand("Target"))
                val declaration = CustomFunction("f", emptyList(), "=@Target!A[1]")
                val before = app.setFunction(app.loadWorkbookBundle(), declaration, null)
                val identity = before.functions.single().identity
                val row = target.tabularContent.rows.first().value
                val column = target.tabularContent.columns.first().value
                val transition = app.saveModelLifecycle(ModelLifecycleRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(before.removeSheet(caller.id))))
                val inserted = RowId.generate()
                store.updateWorkbook { current ->
                    val sheet = current.documents.getValue(target.id)
                    val content = sheet.tabularContent
                    current.replaceSheet(sheet.copy(content = TabularContent(listOf(inserted) + content.rows, content.columns, content.cellContents)))
                }
                val edited = declaration.copy(body = "=@Target!A[1] + 1")
                val current = app.loadWorkbookBundle()
                if (receipted) {
                    app.admitFunctionWrite(FunctionWriteRequest(UUID.randomUUID().toString(), WorkbookReadTransportAdapter.bundle(current), edited, "f"))
                } else app.setFunction(current, edited, "f")
                val restored = app.replayLifecycle(transition.transitionId, LifecycleReplayRequest(UUID.randomUUID().toString(), "undo")).workbook.toLifecycleWorkbook()
                val function = restored.functions.single()
                val binding = function.bodyBindings.getValue(caller.id.value)
                assertEquals(edited.body, function.body)
                assertNotEquals(identity, function.identity)
                assertTrue(binding.contains(row), "binding=$binding original=$row inserted=${inserted.value}")
                assertTrue(binding.contains(column))
                assertTrue(!binding.contains(inserted.value))
            }
        }
    }
}
