package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class ModelLifecycleReconciliationTest {
    @Test
    fun `recreating a historical identity ignores the requested revision and starts at zero`() {
        val workbook = lifecycleWorkbook()
        val original = workbook.sheetsInOrder.first()
        val withoutSheet = workbook.removeSheet(original.id)
        val requested = withoutSheet.addSheet(original.copy(revision = 99))

        val reconciled = reconcileModelLifecycle(withoutSheet, withoutSheet, requested)

        assertEquals(withoutSheet.manifest.revision + 1, reconciled.manifest.revision)
        assertEquals(0, reconciled.documents.getValue(original.id).revision)
        assertEquals(original.copy(revision = 0), reconciled.documents.getValue(original.id))
    }

    @Test
    fun `recreating an identity that current still owns is a survivor update rather than a reset`() {
        val current = lifecycleWorkbook()
        val sheet = current.sheetsInOrder.first()
        val requested = current.replaceSheet(sheet.copy(name = "Renamed", revision = 99))

        val reconciled = reconcileModelLifecycle(current, current, requested)

        assertEquals(current.manifest.revision, reconciled.manifest.revision)
        assertEquals(current.documents.getValue(sheet.id).revision, reconciled.documents.getValue(sheet.id).revision)
        assertEquals("Renamed", reconciled.documents.getValue(sheet.id).name)
    }

    @Test
    fun `reordering existing membership is a real manifest change and is not a semantic no-op`() {
        val current = lifecycleWorkbook()
        val reordered = current.copy(manifest = current.manifest.copy(sheetIds = current.manifest.sheetIds.reversed()))

        assertNotEquals(reordered, current)
        val reconciled = reconcileModelLifecycle(current, current, reordered)
        assertEquals(current.manifest.revision + 1, reconciled.manifest.revision)
        assertEquals(reordered.manifest.sheetIds, reconciled.manifest.sheetIds)
        assertEquals(reordered.sheetsInOrder.map { it.id }, reconciled.sheetsInOrder.map { it.id })
    }

    @Test
    fun `client supplied manifest and document revisions never become stored baselines`() {
        val current = lifecycleWorkbook()
        val after = withUniformRevision(current, 999)

        assertEquals(current, reconcileModelLifecycle(current, current, after))
        assertEquals(current.manifest.revision, reconcileModelLifecycle(current, current, after).manifest.revision)
    }

    @Test
    fun `an already applied after snapshot returns current without advancing the manifest`() {
        val before = lifecycleWorkbook()
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore(before))
        val after = lifecycleBoundWorkbook(before)
        val saved = application.saveModelLifecycle(before, after)

        val replayed = application.saveModelLifecycle(before, after)
        val semanticReplay = application.saveModelLifecycle(saved, saved)

        assertEquals(saved, replayed)
        assertEquals(saved, semanticReplay)
        assertEquals(saved.manifest.revision, application.loadManifest().revision)
    }

    @Test
    fun `a current sheet that before and after both omit is a conflict rather than a silent drop`() {
        val before = lifecycleWorkbook()
        val extra = SheetDocument(SheetId.generate(), name = "Extra")
        val current = before.addSheet(extra)
        val after = before.removeSheet(before.sheetsInOrder.last().id)

        assertEquals(
            WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT,
            assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(current, before, after) }.error,
        )
    }

    @Test
    fun `a missing current sheet that before and after both keep is a conflict rather than a silent drop`() {
        val before = lifecycleWorkbook()
        val current = before.removeSheet(before.sheetsInOrder.last().id)
        val after = before

        assertEquals(
            WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT,
            assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(current, before, after) }.error,
        )
    }

    @Test
    fun `a current sheet that after also creates is recognized as already applied`() {
        val before = lifecycleWorkbook()
        val created = SheetDocument(SheetId.generate(), name = "Created")
        val after = before.addSheet(created)
        val current = after

        assertEquals(current, reconcileModelLifecycle(current, before, after))
    }

    @Test
    fun `deleting a model bound sheet is legal membership change`() {
        val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
        val removed = bound.sheetsInOrder.first()
        val after = bound.removeSheet(removed.id)

        val reconciled = reconcileModelLifecycle(bound, bound, after)

        assertEquals(after, reconciled)
        assertEquals(bound.manifest.revision + 1, reconciled.manifest.revision)
        assertEquals(LIFECYCLE_MODEL, reconciled.documents.getValue(bound.sheetsInOrder.last().id).modelId)
    }

    @Test
    fun `unbinding a surviving calculated sheet is legal while keeping the model and swapping its calculated column is not`() {
        val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
        val sheet = bound.sheetsInOrder.first()
        val unbound = bound.replaceSheet(
            sheet.copy(modelId = null, modelColumnBindings = emptyMap(), modelFormulaBindings = null),
        )
        assertEquals(unbound, reconcileCalculatedLifecycle(bound, bound, unbound, StoredCalculatedTemplates))

        val swapped = sheet.copy(
            modelColumnBindings = mapOf(
                LIFECYCLE_INPUT to sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT),
                LIFECYCLE_OUTPUT to sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT),
            ),
        )
        assertEquals(
            WorkbookApplicationError.CALCULATED_CELL_WRITE,
            assertFailsWith<WorkbookApplicationException> {
                reconcileCalculatedLifecycle(bound, bound, bound.replaceSheet(swapped), StoredCalculatedTemplates)
            }.error,
        )
    }

    @Test
    fun `removing a data model still referenced by a surviving sheet is invalid`() {
        val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
        val after = bound.copy(dataModels = emptyMap())

        assertEquals(
            WorkbookApplicationError.INVALID_MODEL_LIFECYCLE,
            assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(bound, bound, after) }.error,
        )
    }

    @Test
    fun `transport rejects a manifest that names a sheet the documents never carry`() {
        val bundle = WorkbookReadTransportAdapter.bundle(lifecycleWorkbook())
        val unknown = "00000000-0000-0000-0000-000000000099"
        val extraId = bundle.copy(manifest = bundle.manifest.copy(sheetIds = bundle.manifest.sheetIds + unknown))
        val missingDocument = bundle.copy(
            documents = bundle.documents.dropLast(1),
        )

        listOf(extraId, missingDocument).forEach { invalid ->
            assertEquals(
                WorkbookApplicationError.INVALID_MODEL_LIFECYCLE,
                assertFailsWith<WorkbookApplicationException> { invalid.toLifecycleWorkbook() }.error,
            )
        }
    }

    @Test
    fun `membership equal content changes keep the manifest revision in the pure baseline`() {
        val current = lifecycleWorkbook()
        val after = current.replaceSheet(current.sheetsInOrder.first().rename("Renamed"))

        val reconciled = reconcileModelLifecycle(current, current, after)

        assertEquals(current.manifest.revision, reconciled.manifest.revision)
        assertEquals("Renamed", reconciled.sheetsInOrder.first().name)
        assertEquals(current.sheetsInOrder.first().revision, reconciled.sheetsInOrder.first().revision)
    }
}
