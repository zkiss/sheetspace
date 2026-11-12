package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class AtomicAdmissionValidationTest {
    @Test
    fun `invalid permutations targets and manual values leave every sheet and receipt unchanged and permit correction`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val request = scenario.request
        val order = request.rowOrders.first()
        val invalidOrders = listOf(
            listOf(order.copy(order = order.order.dropLast(1))),
            listOf(order.copy(order = order.order + RowId.generate().value)),
            listOf(order.copy(order = listOf(order.order.first()) + order.order.dropLast(1))),
            listOf(order.copy(order = order.order.dropLast(1) + RowId.generate().value)),
            listOf(order.copy(order = order.order.dropLast(1) + "draft")),
            listOf(order, order),
            listOf(order, order.copy(sheetId = order.sheetId.uppercase())),
            listOf(order.copy(sheetId = "bad")),
            listOf(request.rowOrders.last().copy(order = order.order)),
        )
        val invalid = invalidOrders.map { request.copy(rowOrders = it) } + listOf(
            request.copy(values = emptyMap()), request.copy(values = mapOf(LIFECYCLE_INPUT to "wrong")),
            request.copy(values = mapOf(LIFECYCLE_OUTPUT to "4")), request.copy(values = mapOf("bad" to "4")),
            request.copy(rowId = "draft"),
        )
        invalid.forEach { candidate ->
            assertFailsWith<WorkbookApplicationException> { scenario.admit(candidate) }
            assertEquals(scenario.before, store.loadWorkbookBundle())
            assertEquals(0, admissionReceipts(store))
        }
        assertEquals(1, scenario.admit().workbook.documents.getValue(scenario.target.id).revision)
        assertEquals(1, admissionReceipts(store))
    }

    @Test
    fun `duplicate omitted and malformed complete guards reject without admission`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val before = scenario.request.before
        val target = before.documents.first()
        val guards = listOf(
            before.copy(documents = before.documents + target),
            before.copy(documents = before.documents + target.copy(id = target.id.uppercase())),
            before.copy(documents = before.documents.dropLast(1)),
            before.copy(manifest = before.manifest.copy(sheetIds = before.manifest.sheetIds.dropLast(1)), documents = before.documents.dropLast(1)),
            before.copy(dataModels = before.dataModels + before.dataModels.first()),
            before.copy(documents = listOf(target.copy(id = "invalid")) + before.documents.drop(1)),
            before.copy(documents = listOf(target.copy(content = target.content.copy(cells = target.content.cells + target.content.cells.first()))) + before.documents.drop(1)),
        )
        guards.forEach { guard ->
            assertFailsWith<WorkbookApplicationException> { scenario.admit(scenario.request.copy(before = guard)) }
            assertEquals(scenario.before, store.loadWorkbookBundle())
            assertEquals(0, admissionReceipts(store))
        }
        scenario.admit()
        assertEquals(1, admissionReceipts(store))
    }

    @Test
    fun `stale target and cross-sheet revisions report the guarded identity without mutation`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val targetConflict = assertFailsWith<SheetRevisionConflict> { scenario.admit(revision = 9) }
        assertEquals(scenario.target.id.value, targetConflict.sheetId)
        val source = scenario.other
        scenario.app.writeOneCell(source.id.value, "A1", "99", source.revision)
        val current = store.loadWorkbookBundle()
        val conflict = assertFailsWith<SheetRevisionConflict> { scenario.admit() }
        assertEquals(source.id.value, conflict.sheetId)
        assertEquals(source.revision, conflict.expectedRevision)
        assertEquals(source.revision + 1, conflict.actualRevision)
        assertEquals(current, store.loadWorkbookBundle())
        assertEquals(0, admissionReceipts(store))
        scenario.admit(scenario.request.copy(before = WorkbookReadTransportAdapter.bundle(current)))
        assertEquals(1, admissionReceipts(store))
    }

    @Test
    fun `model declaration changes without sheet revision still invalidate the complete read set`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val model = scenario.before.dataModels.getValue(LIFECYCLE_MODEL)
        scenario.app.saveDataModel(model.copy(name = "Changed model"))
        val current = store.loadWorkbookBundle()
        assertEquals(scenario.target.revision, current.documents.getValue(scenario.target.id).revision)
        val conflict = assertFailsWith<WorkbookApplicationException> { scenario.admit() }
        assertEquals(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT, conflict.error)
        assertEquals(current, store.loadWorkbookBundle())
        assertEquals(0, admissionReceipts(store))
        scenario.admit(scenario.request.copy(before = WorkbookReadTransportAdapter.bundle(current)))
        assertEquals(1, admissionReceipts(store))
    }

    @Test
    fun `missing guarded sheets and unknown order targets report their own identities`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val missing = SheetId.generate()
        val invalid = scenario.request.copy(rowOrders = listOf(RecordRowOrder(missing.value, emptyList())))
        val unknown = assertFailsWith<WorkbookApplicationException> { scenario.admit(invalid) }
        assertEquals(missing.value, unknown.sheetId)
        scenario.app.deleteSheet(scenario.untouched.id.value, scenario.untouched.revision)
        val current = store.loadWorkbookBundle()
        val deleted = assertFailsWith<WorkbookApplicationException> { scenario.admit() }
        assertEquals(scenario.untouched.id.value, deleted.sheetId)
        assertEquals(current, store.loadWorkbookBundle())
        assertEquals(0, admissionReceipts(store))
    }
}
