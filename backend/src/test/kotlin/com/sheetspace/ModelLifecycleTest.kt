package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ModelLifecycleTest {
    @Test
    fun `metadata writes prune only obsolete templates without invoking lifecycle transformations`() {
        val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore(bound))
        val original = bound.dataModels.getValue(LIFECYCLE_MODEL)
        application.saveDataModel(original.copy(name = "Renamed"))
        assertEquals(bound.sheetsInOrder.map { it.modelFormulaBindings }, application.loadWorkbookBundle().sheetsInOrder.map { it.modelFormulaBindings })
        application.saveDataModel(original.copy(columns = listOf(original.columns[0], (original.columns[1] as CalculatedModelColumn).copy(formula = "=2"))))
        assertEquals(listOf(emptyMap(), emptyMap()), application.loadWorkbookBundle().sheetsInOrder.map { it.modelFormulaBindings })
        assertEquals(bound.sheetsInOrder.map { it.content }, application.loadWorkbookBundle().sheetsInOrder.map { it.content })
    }

    @Test
    fun `semantic compare and swap permits prior queued revision changes but rejects concurrent declaration edits`() {
        val before = lifecycleWorkbook()
        val after = lifecycleBoundWorkbook(before)
        val newerRevision = before.copy(manifest = before.manifest.copy(revision = 50), documents = before.documents.mapValues { (_, sheet) -> sheet.copy(revision = 42) })

        val updated = reconcileModelLifecycle(newerRevision, before, after)

        assertEquals(50, updated.manifest.revision)
        assertEquals(listOf(42L, 42L), updated.sheetsInOrder.map { it.revision })
        val concurrent = before.copy(dataModels = before.dataModels.mapValues { (_, model) -> model.copy(name = "Concurrent") })
        assertEquals(WorkbookApplicationError.MODEL_LIFECYCLE_CONFLICT, assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(concurrent, before, after) }.error)
    }

    @Test
    fun `lifecycle boundary keeps workbook membership and declaration identities fixed`() {
        val before = lifecycleWorkbook()
        val sheet = before.sheetsInOrder.first()
        val changedMembership = before.removeSheet(sheet.id)
        val changedModels = before.copy(dataModels = emptyMap())

        listOf(changedMembership, changedModels).forEach { after ->
            assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(before, before, after) }.error)
        }
    }

    @Test
    fun `invalid workbook shapes are rejected before any structural persistence`() {
        val before = lifecycleWorkbook()
        val bound = lifecycleBoundWorkbook(before)
        val invalidSheets: List<(SheetDocument) -> SheetDocument> = listOf(
            { it.copy(id = SheetId("invalid")) },
            { it.copy(name = " ") },
            { it.copy(content = TabularContent(listOf(RowId("invalid")), it.tabularContent.columns, emptyMap())) },
            { it.copy(content = TabularContent(it.tabularContent.rows, listOf(ColumnId("invalid")), emptyMap())) },
            { it.copy(frame = it.frame.copy(position = WorkspacePosition(Double.NaN, 0.0))) },
            { it.copy(frame = it.frame.copy(size = SheetFrameSize(0.0, 10.0))) },
            { it.copy(frame = it.frame.copy(visualScale = -1.0)) },
            { it.copy(frame = it.frame.copy(zIndex = 0)) },
            { it.copy(modelColumnBindings = mapOf("unknown" to it.tabularContent.columns.first())) },
        )
        invalidSheets.forEach { transform ->
            val invalid = bound.copy(documents = bound.documents.mapValues { (_, sheet) -> transform(sheet) })
            assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(before, before, invalid) }.error)
        }
        val invalidModel = bound.copy(dataModels = bound.dataModels.mapValues { (_, model) -> model.copy(name = " ") })
        val invalidVersion = bound.copy(manifest = bound.manifest.copy(version = -1))
        listOf(invalidModel, invalidVersion).forEach { invalid ->
            assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(before, before, invalid) }.error)
        }
    }

    @Test
    fun `presentation and unresolved or qualified template metadata are validated and preserved`() {
        val before = lifecycleWorkbook()
        val bound = lifecycleBoundWorkbook(before)
        val changed = bound.copy(documents = bound.documents.mapValues { (_, sheet) ->
            val template = sheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT)
            val reference = template.references.first()
            sheet.copy(
                modelFormulaBindings = mapOf(LIFECYCLE_OUTPUT to template.copy(references = listOf(reference.copy(qualifierSpan = ModelFormulaSpan(1, 2), endpoints = listOf(null)), reference.copy(endpoints = reference.endpoints.map { it!!.copy(rowIndex = 3e9) })))),
                presentation = sheet.presentation.copy(formatOverrides = SheetFormatOverrides(
                    rows = mapOf(sheet.tabularContent.rows[0].value to CellFormat(fontWeight = "bold")),
                    columns = mapOf(sheet.tabularContent.columns[0].value to CellFormat(numberFormat = NumberFormat("number", 2))),
                    cells = mapOf("${sheet.tabularContent.rows[0].value}\u0000${sheet.tabularContent.columns[0].value}" to CellFormat(textColor = "#123456")),
                )),
            )
        })

        assertEquals(changed, reconcileModelLifecycle(before, before, changed))
        assertEquals(changed, Json.decodeFromString<WorkbookBundleResponse>(Json.encodeToString(WorkbookReadTransportAdapter.bundle(changed))).toLifecycleWorkbook())
        val zeroWidth = before.copy(documents = before.documents.mapValues { (_, sheet) -> sheet.copy(content = TabularContent(rowCount = 0, columnCount = 0)) })
        assertEquals(zeroWidth, reconcileModelLifecycle(before, before, zeroWidth))
    }

    @Test
    fun `malformed template ownership source spans and endpoints are rejected`() {
        val before = lifecycleWorkbook()
        val bound = lifecycleBoundWorkbook(before)
        val invalidTemplates: List<(BoundModelFormula) -> BoundModelFormula> = listOf(
            { it.copy(raw = "=different") },
            { it.copy(references = it.references.map { reference -> reference.copy(sourceSpan = ModelFormulaSpan(-1, 3)) }) },
            { it.copy(references = it.references.map { reference -> reference.copy(sourceSpan = ModelFormulaSpan(3, 3)) }) },
            { it.copy(references = it.references.map { reference -> reference.copy(sourceSpan = ModelFormulaSpan(0, 100)) }) },
            { it.copy(references = it.references.map { reference -> reference.copy(qualifierSpan = ModelFormulaSpan(-1, 3)) }) },
            { it.copy(references = it.references.map { reference -> reference.copy(endpoints = emptyList()) }) },
            { it.copy(references = it.references.map { reference -> reference.copy(endpoints = List(3) { null }) }) },
            { it.copy(references = it.references.map { reference -> reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(sourceSpan = ModelFormulaSpan(-1, 3)) }) }) },
            { it.copy(references = it.references.map { reference -> reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(rowIndex = -1.0) }) }) },
            { it.copy(references = it.references.map { reference -> reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(rowIndex = Double.POSITIVE_INFINITY) }) }) },
            { it.copy(references = it.references.map { reference -> reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(columnId = "invalid") }) }) },
        )
        invalidTemplates.forEach { transform ->
            val invalid = bound.copy(documents = bound.documents.mapValues { (_, sheet) -> sheet.copy(modelFormulaBindings = sheet.modelFormulaBindings!!.mapValues { transform(it.value) }) })
            assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(before, before, invalid) }.error)
        }
        listOf("missing", LIFECYCLE_INPUT).forEach { propertyId ->
            val invalid = bound.copy(documents = bound.documents.mapValues { (_, sheet) -> sheet.copy(modelFormulaBindings = mapOf(propertyId to sheet.modelFormulaBindings!!.values.first())) })
            assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(before, before, invalid) }.error)
        }
    }

    @Test
    fun `malformed transport collections do not collapse duplicate identities or cells`() {
        val bundle = WorkbookReadTransportAdapter.bundle(lifecycleWorkbook())
        val first = bundle.documents.first()
        val duplicateCell = first.content.cells.first()
        val invalidBundles = listOf(
            bundle.copy(documents = bundle.documents + first),
            bundle.copy(dataModels = bundle.dataModels + bundle.dataModels.first()),
            bundle.copy(manifest = bundle.manifest.copy(sheetIds = bundle.manifest.sheetIds + first.id)),
            bundle.copy(manifest = bundle.manifest.copy(sheetIds = emptyList())),
            bundle.copy(documents = bundle.documents.map { it.copy(content = it.content.copy(kind = "unknown")) }),
            bundle.copy(documents = listOf(first.copy(content = first.content.copy(cells = listOf(duplicateCell, duplicateCell))))),
            bundle.copy(documents = bundle.documents.map { it.copy(content = it.content.copy(cells = listOf(duplicateCell.copy(content = "")))) }),
            bundle.copy(documents = listOf(first.copy(content = first.content.copy(rows = first.content.rows + first.content.rows.first())))),
            bundle.copy(dataModels = bundle.dataModels.map { model -> model.copy(columns = model.columns.map { it.copy(type = "unknown") }) }),
        )
        invalidBundles.forEach { invalid ->
            assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, assertFailsWith<WorkbookApplicationException> { invalid.toLifecycleWorkbook() }.error)
        }
    }
}
