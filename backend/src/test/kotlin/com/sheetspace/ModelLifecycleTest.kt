package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ModelLifecycleTest {
    @Test
    fun `template-free declaration writes reject calculated formula changes while lifecycle reconciles every bound sheet`() {
        val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore(bound))
        val original = bound.dataModels.getValue(LIFECYCLE_MODEL)
        application.saveDataModel(original.copy(name = "Renamed"))
        assertEquals(bound.sheetsInOrder.map { it.modelFormulaBindings }, application.loadWorkbookBundle().sheetsInOrder.map { it.modelFormulaBindings })
        val formulaChanged = original.copy(columns = listOf(original.columns[0], (original.columns[1] as CalculatedModelColumn).copy(formula = "=@A[1]*3")))

        assertEquals(
            WorkbookApplicationError.INVALID_MODEL_LIFECYCLE,
            assertFailsWith<WorkbookApplicationException> { application.saveDataModel(formulaChanged) }.error,
        )
        assertEquals(bound.copy(dataModels = bound.dataModels + (original.id to original.copy(name = "Renamed"))), application.loadWorkbookBundle())

        val before = application.loadWorkbookBundle()
        val reconciled = formulaChangedWorkbook(before, formulaChanged)
        val saved = application.saveModelLifecycle(before, reconciled)

        assertEquals(formulaChanged, saved.dataModels.getValue(LIFECYCLE_MODEL))
        saved.sheetsInOrder.forEach { sheet ->
            assertEquals("=@A[1]*3", sheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT).raw)
            assertEquals(
                sheet.tabularContent.rows.map { row -> "=@${sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT).value}[${row.value}]*3" },
                sheet.tabularContent.rows.map { row -> sheet.tabularContent.cellContents.getValue(CellCoordinate(row, sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT))) },
            )
        }
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

    @Test
    fun `derived-content validation distinguishes complete calculated bindings from omitted or stale values`() {
        val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
        val sheet = bound.sheetsInOrder.first()
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val missingOutput = bound.replaceSheet(
            sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, sheet.tabularContent.cellContents - CellCoordinate(sheet.tabularContent.rows.first(), output))),
        )
        val staleTemplate = bound.replaceSheet(
            sheet.copy(modelFormulaBindings = sheet.modelFormulaBindings!!.mapValues { (_, template) -> template.copy(raw = "=stale") }),
        )
        val missingTemplates = bound.replaceSheet(sheet.copy(modelFormulaBindings = null))
        val incompleteTemplates = bound.replaceSheet(sheet.copy(modelFormulaBindings = emptyMap()))

        assertEquals(true, calculatedContentsAreDerived(bound))
        assertEquals(false, calculatedContentsAreDerived(missingOutput))
        assertEquals(true, calculatedContentsAreDerived(missingOutput) { candidate, row -> candidate.id == sheet.id && row == sheet.tabularContent.rows.first() })
        assertEquals(false, calculatedContentsAreDerived(staleTemplate))
        assertEquals(false, calculatedContentsAreDerived(missingTemplates))
        assertEquals(false, calculatedContentsAreDerived(incompleteTemplates))
        assertEquals(true, calculatedContentsAreDerived(lifecycleWorkbook()))
    }

    @Test
    fun `derived formulas preserve valid references and replace unresolved bindings with ref errors`() {
        val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
        val sheet = bound.sheetsInOrder.first()
        val template = sheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT)
        val input = sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT)
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val expected = "=@${input.value}[${sheet.tabularContent.rows[1].value}]*2"
        val derivedWrite = SheetCellWrite(sheet.id.value, sheet.tabularContent.rows[1].value, output.value, expected)

        assertEquals(expected, derivedFormulaRaw(template, bound, 1))
        assertEquals(true, isDerivedCalculatedWrite(bound, sheet, derivedWrite))
        assertEquals(false, isDerivedCalculatedWrite(bound, sheet, derivedWrite.copy(raw = "=stale")))
        assertEquals(false, isDerivedCalculatedWrite(bound, sheet, derivedWrite.copy(columnId = input.value)))
        assertEquals(false, isDerivedCalculatedWrite(bound, sheet.copy(modelFormulaBindings = null), derivedWrite))
        assertEquals(false, isDerivedCalculatedWrite(bound, sheet.copy(modelId = null), derivedWrite))
        val extraCalculatedProperty = "31000000-0000-0000-0000-000000000098"
        val modelWithLeadingCalculatedProperty = bound.dataModels.getValue(LIFECYCLE_MODEL).copy(
            columns = listOf(CalculatedModelColumn(extraCalculatedProperty, "Earlier", ModelColumnType.FLOAT, "=1")) + bound.dataModels.getValue(LIFECYCLE_MODEL).columns,
        )
        val workbookWithLeadingCalculatedProperty = bound.copy(dataModels = bound.dataModels + (LIFECYCLE_MODEL to modelWithLeadingCalculatedProperty)).replaceSheet(
            sheet.copy(modelColumnBindings = sheet.modelColumnBindings + (extraCalculatedProperty to input)),
        )
        assertEquals(true, isDerivedCalculatedWrite(workbookWithLeadingCalculatedProperty, workbookWithLeadingCalculatedProperty.documents.getValue(sheet.id), derivedWrite))
        assertEquals(
            expected,
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(propertyId = LIFECYCLE_INPUT) })
                }),
                bound,
                1,
            ),
        )
        assertEquals(
            "=@${output.value}[${sheet.tabularContent.rows[1].value}]*2",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(columnId = output.value, propertyId = LIFECYCLE_OUTPUT) })
                }),
                bound,
                1,
            ),
        )
        assertEquals("=@#REF!A[1]*2", derivedFormulaRaw(template.copy(references = template.references.map { it.copy(sheetId = "missing") }), bound, 0))
        assertEquals("=@#REF!A[1]*2", derivedFormulaRaw(template.copy(references = template.references.map { it.copy(sheetId = null) }), bound, 0))
        assertEquals(
            "=@#REF!A[1]*2",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(sheetId = "missing", endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(propertyId = LIFECYCLE_INPUT) })
                }),
                bound,
                0,
            ),
        )
        val missingPropertyBinding = bound.replaceSheet(sheet.copy(modelColumnBindings = sheet.modelColumnBindings - LIFECYCLE_INPUT))
        assertEquals(
            "=@#REF!A[1]*2",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(propertyId = LIFECYCLE_INPUT) })
                }),
                missingPropertyBinding,
                0,
            ),
        )
        assertEquals(
            "=@#REF!A[1]*2",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(propertyId = "missing") })
                }),
                bound,
                0,
            ),
        )
        val undeclaredProperty = "31000000-0000-0000-0000-000000000099"
        val sheetWithUndeclaredBinding = sheet.copy(modelColumnBindings = sheet.modelColumnBindings + (undeclaredProperty to input))
        val workbookWithUndeclaredBinding = bound.replaceSheet(sheetWithUndeclaredBinding)
        assertEquals(
            "=@#REF!A[1]*2",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(propertyId = undeclaredProperty) })
                }),
                workbookWithUndeclaredBinding,
                0,
            ),
        )
        assertEquals(
            "=@#REF!A[1]*2",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(columnId = ColumnId.generate().value) })
                }),
                bound,
                0,
            ),
        )
        assertEquals(
            "=@#REF!A[1]*2",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(rowIndex = 100.0) })
                }),
                bound,
                0,
            ),
        )
        assertEquals(
            "=@#REF!A[1]*2",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = listOf(null))
                }),
                bound,
                0,
            ),
        )
        val qualified = BoundModelFormula(
            "=One!@A[1]",
            listOf(
                ModelFormulaReference(
                    ModelFormulaSpan(5, 10),
                    sheet.id.value,
                    ModelFormulaSpan(1, 4),
                    listOf(ModelFormulaEndpoint(ModelFormulaSpan(6, 10), input.value, 0.0, ModelFormulaAnchors(false, false))),
                ),
            ),
        )
        assertEquals("=${sheet.id.value}!@${input.value}[${sheet.tabularContent.rows[0].value}]", derivedFormulaRaw(qualified, bound, 0))
    }

    @Test
    fun `template-free declaration edits remain available before a calculated model is bound`() {
        val before = lifecycleWorkbook()
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore(before))
        val original = before.dataModels.getValue(LIFECYCLE_MODEL)
        val changed = original.copy(columns = listOf(original.columns[0], (original.columns[1] as CalculatedModelColumn).copy(formula = "=@A[1]*3")))

        assertEquals(changed, application.saveDataModel(changed))
        assertEquals(
            WorkbookApplicationError.SHEET_NOT_FOUND,
            assertFailsWith<WorkbookApplicationException> {
                application.updateSheetModel("40000000-0000-0000-0000-000000000099", UpdateSheetModelCommand(LIFECYCLE_MODEL))
            }.error,
        )
    }

    @Test
    fun `template-free model binding rejects calculated custom and partial mappings without mutation`() {
        val before = lifecycleWorkbook()
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore(before))
        val sheet = before.sheetsInOrder.first()
        val customBindings = mapOf(
            LIFECYCLE_INPUT to sheet.tabularContent.columns[2],
            LIFECYCLE_OUTPUT to sheet.tabularContent.columns[1],
        )
        val partialBindings = mapOf(LIFECYCLE_INPUT to sheet.tabularContent.columns[2])

        listOf(customBindings, partialBindings).forEach { bindings ->
            assertEquals(
                WorkbookApplicationError.INVALID_MODEL_LIFECYCLE,
                assertFailsWith<WorkbookApplicationException> {
                    application.updateSheetModel(sheet.id.value, UpdateSheetModelCommand(LIFECYCLE_MODEL, bindings))
                }.error,
            )
            assertEquals(before, application.loadWorkbookBundle())
        }

        val bound = application.saveModelLifecycle(before, lifecycleBoundWorkbook(before))
        val boundSheet = bound.documents.getValue(sheet.id)
        val changedBindings = mapOf(
            LIFECYCLE_INPUT to boundSheet.tabularContent.columns[1],
            LIFECYCLE_OUTPUT to boundSheet.tabularContent.columns[0],
        )
        val clearedCalculatedBinding = mapOf(LIFECYCLE_INPUT to boundSheet.tabularContent.columns[1])

        listOf(changedBindings, clearedCalculatedBinding).forEach { bindings ->
            assertEquals(
                WorkbookApplicationError.INVALID_MODEL_LIFECYCLE,
                assertFailsWith<WorkbookApplicationException> {
                    application.updateSheetModel(sheet.id.value, UpdateSheetModelCommand(LIFECYCLE_MODEL, bindings))
                }.error,
            )
            assertEquals(bound, application.loadWorkbookBundle())
        }
    }

    @Test
    fun `model validation rejects malformed calculated declarations before lifecycle selection`() {
        val model = lifecycleWorkbook().dataModels.getValue(LIFECYCLE_MODEL)

        assertEquals(false, isValidDataModel(model.copy(columns = listOf(model.columns[0], (model.columns[1] as CalculatedModelColumn).copy(formula = " ")))))
        assertEquals(false, isValidDataModel(model.copy(columns = listOf(ManualModelColumn("invalid", "Input", ModelColumnType.FLOAT), model.columns[1]))))
    }
}

internal fun formulaChangedWorkbook(before: WorkbookState, model: DataModel): WorkbookState = before.copy(
    dataModels = before.dataModels + (model.id to model),
    documents = before.documents.mapValues { (_, sheet) ->
        val input = sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT)
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        sheet.copy(
            modelFormulaBindings = sheet.modelFormulaBindings!!.mapValues { (_, template) -> template.copy(raw = "=@A[1]*3") },
            content = sheet.tabularContent.let { content ->
                content.rows.fold(content) { updated, row ->
                    updated.updateCell(updated.addressOf(CellCoordinate(row, output))!!, "=@${input.value}[${row.value}]*3")
                }
            },
        )
    },
)
