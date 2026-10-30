package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive

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
            val template = sheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT)
            assertEquals("=@A[1]*3", StoredFormulaCodec.decode(template.content).text)
            assertEquals(
                sheet.tabularContent.rows.indices.map { index -> instantiateStoredModelFormula(template.content, index) { sheet.tabularContent.rows.map { it.value } } },
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
    fun `in-memory lifecycle persistence derives revisions and preserves semantic replay`() {
        val before = lifecycleWorkbook()
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore(before))
        val after = lifecycleBoundWorkbook(before)

        val saved = application.saveModelLifecycle(before, after)
        val replayed = application.saveModelLifecycle(saved, saved)

        assertEquals(listOf(1L, 1L), saved.sheetsInOrder.map(SheetDocument::revision))
        assertEquals(saved, replayed)
    }

    @Test
    fun `lifecycle boundary keeps sheet membership fixed while allowing model membership changes`() {
        val before = lifecycleWorkbook()
        val sheet = before.sheetsInOrder.first()
        val changedMembership = before.removeSheet(sheet.id)
        val changedModels = before.copy(dataModels = emptyMap())

        assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, assertFailsWith<WorkbookApplicationException> { reconcileModelLifecycle(before, before, changedMembership) }.error)
        assertEquals(changedModels, reconcileModelLifecycle(before, before, changedModels))
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
            val formula = StoredFormulaCodec.decode(template.content)
            val occurrence = formula.occurrences.single()
            val changedTemplate = BoundModelFormula(StoredFormulaCodec.encode(formula.copy(occurrences = listOf(
                occurrence.copy(slots = occurrence.slots.map { slot ->
                    if (slot.id == "r") slot.copy(key = JsonPrimitive(3000000000L), status = "unresolved", targetIds = emptyList()) else slot
                }),
            ))))
            val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
            val content = sheet.tabularContent.rows.foldIndexed(sheet.tabularContent) { index, updated, row ->
                updated.updateCell(updated.addressOf(CellCoordinate(row, output))!!,
                    instantiateStoredModelFormula(changedTemplate.content, index) { sheet.tabularContent.rows.map { it.value } })
            }
            sheet.copy(
                modelFormulaBindings = mapOf(LIFECYCLE_OUTPUT to changedTemplate),
                content = content,
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
            { BoundModelFormula(StoredFormulaCodec.encode(StoredFormula("=different", emptyList()))) },
            { it.copy(content = "=~F1[\"=@A[1]*2\",[[\"o\",[-1,6],\"s\",[],[],[]]]]") },
            { it.copy(content = "=~F1[\"=@A[1]*2\",[[\"o\",[1,99],\"s\",[],[],[]]]]") },
            { it.copy(content = "=~F1[\"=@A[1]*2\",[[\"o\",[1,6],\"s\",[[\"e\",\"missing\",\"r\",false,false]],[],[]]]]") },
            { it.copy(content = "=~F1[\"=@A[1]*2\",[[\"o\",[1,6],\"s\",[],[[\"s\",\"sheet\",null,\"retained\",[]]],[]]]]") },
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
            sheet.copy(modelFormulaBindings = sheet.modelFormulaBindings!!.mapValues { (_, _) -> BoundModelFormula(StoredFormulaCodec.encode(StoredFormula("=stale", emptyList()))) }),
        )
        val missingTemplates = bound.replaceSheet(sheet.copy(modelFormulaBindings = null))
        val incompleteTemplates = bound.replaceSheet(sheet.copy(modelFormulaBindings = emptyMap()))

        assertEquals(true, calculatedContentsAreDerived(bound))
        assertEquals(false, calculatedContentsAreDerived(missingOutput))
        assertEquals(false, calculatedContentsAreDerived(staleTemplate))
        assertEquals(false, calculatedContentsAreDerived(missingTemplates))
        assertEquals(false, calculatedContentsAreDerived(incompleteTemplates))
        assertEquals(true, calculatedContentsAreDerived(lifecycleWorkbook()))
    }

    @Test
    fun `derived formulas preserve text and identity provenance while refreshing row recipes`() {
        val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
        val sheet = bound.sheetsInOrder.first()
        val template = sheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT)
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val original = StoredFormulaCodec.decode(template.content)
        val instance = StoredFormulaCodec.decode(derivedFormulaRaw(template, bound, 1))

        assertEquals(original.text, instance.text)
        assertEquals(original.occurrences.single().slots.single { it.id == "c" }, instance.occurrences.single().slots.single { it.id == "c" })
        assertEquals(listOf(sheet.tabularContent.rows[1].value), instance.occurrences.single().slots.single { it.id == "r" }.targetIds)
        assertEquals(true, calculatedContentsAreDerived(bound))
        val staleContent = bound.replaceSheet(sheet.updateTabularContent { content ->
            content.updateCell(content.addressOf(CellCoordinate(sheet.tabularContent.rows[1], output))!!, "=stale")
        })
        assertEquals(false, calculatedContentsAreDerived(staleContent))

        val occurrence = original.occurrences.single()
        val property = occurrence.copy(slots = occurrence.slots.map { slot ->
            if (slot.id == "c") slot.copy(kind = "property", key = JsonPrimitive("Missing"), targetIds = listOf("missing-property", "missing-column")) else slot
        })
        val propertyTemplate = BoundModelFormula(StoredFormulaCodec.encode(original.copy(occurrences = listOf(property))))
        val retained = StoredFormulaCodec.decode(derivedFormulaRaw(propertyTemplate, bound, 1)).occurrences.single()
        assertEquals(listOf("missing-property", "missing-column"), retained.slots.single { it.id == "c" }.targetIds)
        assertEquals(listOf(sheet.tabularContent.rows[1].value), retained.slots.single { it.id == "r" }.targetIds)

        val missingSheet = occurrence.copy(slots = occurrence.slots.map { slot ->
            if (slot.id == "s") slot.copy(targetIds = listOf("missing-sheet")) else slot
        })
        val missingTemplate = BoundModelFormula(StoredFormulaCodec.encode(original.copy(occurrences = listOf(missingSheet))))
        assertEquals(missingTemplate.content, derivedFormulaRaw(missingTemplate, bound, 1))
        val unavailableRow = StoredFormulaCodec.decode(derivedFormulaRaw(template, bound, 100)).occurrences.single().slots.single { it.id == "r" }
        assertEquals("unresolved", unavailableRow.status)
        assertEquals(emptyList(), unavailableRow.targetIds)
        val anchored = lifecycleTemplate(sheet, sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT), "=@A[$1]*2", anchored = true)
        val anchoredRow = StoredFormulaCodec.decode(derivedFormulaRaw(anchored, bound, 1)).occurrences.single().slots.single { it.id == "r" }
        assertEquals(listOf(sheet.tabularContent.rows[0].value), anchoredRow.targetIds)
    }

    @Test
    fun `qualified templates derive rows from the referenced sheet and survive lifecycle transport`() {
        val before = lifecycleWorkbook()
        val bound = lifecycleBoundWorkbook(before)
        val target = bound.sheetsInOrder.first()
        val source = bound.sheetsInOrder.last()
        val declaration = "=One!@A[1]"
        val occurrence = FormulaOccurrence(
            "o", FormulaSpan(1, 10), "s", listOf(FormulaEndpoint("e", "c", "r", false, false)),
            listOf(
                FormulaSlot("s", "sheet", JsonPrimitive("One"), "retained", listOf(target.id.value)),
                FormulaSlot("c", "column", JsonPrimitive(0), "retained", listOf(target.tabularContent.columns[0].value)),
                FormulaSlot("r", "row", JsonPrimitive(1), "retained", listOf(target.tabularContent.rows[0].value)),
            ), emptyList(),
        )
        val template = BoundModelFormula(StoredFormulaCodec.encode(StoredFormula(declaration, listOf(occurrence))))
        val model = bound.dataModels.getValue(LIFECYCLE_MODEL)
        val changedModel = model.copy(columns = listOf(model.columns[0], (model.columns[1] as CalculatedModelColumn).copy(formula = declaration)))
        val changed = bound.copy(dataModels = bound.dataModels + (model.id to changedModel), documents = bound.documents.mapValues { (_, sheet) ->
            val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
            val content = sheet.tabularContent.rows.foldIndexed(sheet.tabularContent) { index, current, row ->
                current.updateCell(current.addressOf(CellCoordinate(row, output))!!, derivedFormulaRaw(template, bound, index))
            }
            sheet.copy(modelFormulaBindings = mapOf(LIFECYCLE_OUTPUT to template), content = content)
        })

        val saved = DefaultWorkbookApplication(InMemoryWorkbookStore(before)).saveModelLifecycle(before, changed)
        val reloaded = Json.decodeFromString<WorkbookBundleResponse>(Json.encodeToString(WorkbookReadTransportAdapter.bundle(saved))).toLifecycleWorkbook()
        val savedSource = reloaded.documents.getValue(source.id)
        assertEquals(template, savedSource.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT))
        savedSource.tabularContent.rows.forEachIndexed { index, row ->
            val content = savedSource.tabularContent.cellContents.getValue(CellCoordinate(row, savedSource.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)))
            val instance = StoredFormulaCodec.decode(content)
            assertEquals(declaration, instance.text)
            assertEquals(occurrence.slots[0], instance.occurrences.single().slots[0])
            assertEquals(occurrence.slots[1], instance.occurrences.single().slots[1])
            assertEquals(listOf(target.tabularContent.rows[index].value), instance.occurrences.single().slots[2].targetIds)
        }
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
    fun `template-free model binding rejects calculated custom partial and emptied mappings without mutation`() {
        val before = lifecycleWorkbook()
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore(before))
        val sheet = before.sheetsInOrder.first()
        val customBindings = mapOf(
            LIFECYCLE_INPUT to sheet.tabularContent.columns[2],
            LIFECYCLE_OUTPUT to sheet.tabularContent.columns[1],
        )
        val partialBindings = mapOf(LIFECYCLE_INPUT to sheet.tabularContent.columns[2])
        val emptiedBindings = emptyMap<String, ColumnId>()

        listOf(customBindings, partialBindings, emptiedBindings).forEach { bindings ->
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

        listOf(changedBindings, clearedCalculatedBinding, emptiedBindings).forEach { bindings ->
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
            modelFormulaBindings = sheet.modelFormulaBindings!!.mapValues { (_, _) -> lifecycleTemplate(sheet, input, "=@A[1]*3") },
            content = sheet.tabularContent.let { content ->
                content.rows.fold(content) { updated, row ->
                    val template = lifecycleTemplate(sheet, input, "=@A[1]*3")
                    val index = content.rows.indexOf(row)
                    updated.updateCell(updated.addressOf(CellCoordinate(row, output))!!,
                        instantiateStoredModelFormula(template.content, index) { content.rows.map { it.value } })
                }
            },
        )
    },
)
