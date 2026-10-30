package com.sheetspace

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CalculatedTransitionAuthorityTest {
    @Test
    fun `projected property and ordinary names preserve reordered calculated instances on save`() {
        listOf(false to false, false to true, true to false, true to true).forEach { (ordinary, anchoredColumn) ->
            withSqliteStore { store ->
                val full = transitionWorkbook()
                val base = if (ordinary) full.removeSheet(full.sheetsInOrder.last().id) else full
                val sheet = base.sheetsInOrder.first()
                val input = sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT)
                val target = if (ordinary) ColumnId.generate() else input
                val identity = if (ordinary) target.value else LIFECYCLE_INPUT
                fun hex(value: String) = value.map { it.code.toString(16).padStart(4, '0') }.joinToString("")
                val anchor = if (anchoredColumn) "$" else ""
                val formula = "=@${anchor}Input[$1]*2"
                val template = BoundModelFormula("=@${anchor}~${hex(identity)}~${hex(target.value)}[$${hex(sheet.tabularContent.rows.first().value)}]*2")
                val model = base.dataModels.getValue(LIFECYCLE_MODEL)
                val prepared = base.copy(dataModels = base.dataModels + (model.id to model.copy(columns = model.columns.map {
                    if (it is CalculatedModelColumn) it.copy(formula = formula) else if (ordinary && it.id == LIFECYCLE_INPUT) (it as ManualModelColumn).copy(name = "Other") else it
                })), documents = base.documents.mapValues { (_, document) ->
                    val column = if (document.id == sheet.id) target else document.modelColumnBindings.getValue(LIFECYCLE_INPUT)
                    val id = if (ordinary && document.id == sheet.id) column.value else LIFECYCLE_INPUT
                    val binding = BoundModelFormula("=@${anchor}~${hex(id)}~${hex(column.value)}[$${hex(document.tabularContent.rows.first().value)}]*2")
                    document.copy(modelFormulaBindings = mapOf(LIFECYCLE_OUTPUT to binding),
                        columnNames = if (ordinary && document.id == sheet.id) mapOf(target.value to "Input") else emptyMap(),
                        content = TabularContent(document.tabularContent.rows, document.tabularContent.columns + if (ordinary && document.id == sheet.id) listOf(target) else emptyList(), document.tabularContent.cellContents))
                })
                val instantiated = freshlyInstantiated(prepared)
                val reordered = instantiated.copy(documents = instantiated.documents.mapValues { (_, document) -> document.copy(content = TabularContent(
                    document.tabularContent.rows.reversed(), document.tabularContent.columns, document.tabularContent.cellContents,
                )) })
                val renamedModel = reordered.dataModels.getValue(LIFECYCLE_MODEL).copy(columns = reordered.dataModels.getValue(LIFECYCLE_MODEL).columns.map {
                    when {
                        it is CalculatedModelColumn -> it.copy(formula = "=@${anchor}Revenue[$1]*2")
                        !ordinary && it.id == LIFECYCLE_INPUT -> (it as ManualModelColumn).copy(name = "Revenue")
                        else -> it
                    }
                })
                val renamed = reordered.copy(dataModels = reordered.dataModels + (model.id to renamedModel), documents = reordered.documents.mapValues { (_, document) ->
                    document.copy(columnNames = if (ordinary && document.id == sheet.id) mapOf(target.value to "Revenue") else document.columnNames)
                })
                store.saveWorkbook(instantiated)
                val application = DefaultWorkbookApplication(store)
                application.saveModelLifecycle(instantiated, reordered)
                val saved = application.saveModelLifecycle(reordered, renamed)
                assertEquals(saved, store.loadWorkbookBundle())
                assertEquals(renamed.documents.mapValues { it.value.tabularContent }, saved.documents.mapValues { it.value.tabularContent })
                assertFalse(calculatedTransitionIsValid(reordered, freshlyInstantiated(renamed)))
                assertEquals(template, prepared.documents.getValue(sheet.id).modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT))
                val edited = renamed.copy(dataModels = renamed.dataModels.mapValues { (_, value) -> value.copy(columns = value.columns.map {
                    if (it is CalculatedModelColumn) it.copy(formula = it.formula.replace("[$1]", "[$3]")) else it
                }) })
                assertFalse(calculatedTransitionIsValid(reordered, edited))
                val quotedModel = renamedModel.copy(columns = renamedModel.columns.map {
                    when {
                        it is CalculatedModelColumn -> it.copy(formula = "=@${anchor}'O''Brien total'[$1]*2")
                        !ordinary && it.id == LIFECYCLE_INPUT -> (it as ManualModelColumn).copy(name = "O'Brien total")
                        else -> it
                    }
                })
                val quoted = renamed.copy(dataModels = renamed.dataModels + (model.id to quotedModel), documents = renamed.documents.mapValues { (_, document) ->
                    document.copy(columnNames = if (ordinary && document.id == sheet.id) mapOf(target.value to "O'Brien total") else document.columnNames)
                })
                assertTrue(calculatedTransitionIsValid(renamed, quoted))
                val forgedName = quoted.copy(dataModels = quoted.dataModels.mapValues { (_, value) -> value.copy(columns = value.columns.map {
                    if (it is CalculatedModelColumn) it.copy(formula = "=@${anchor}'Not the target'[$1]*2") else it
                }) })
                assertFalse(calculatedTransitionIsValid(renamed, forgedName))
                val forgedOperator = quoted.copy(dataModels = quoted.dataModels.mapValues { (_, value) -> value.copy(columns = value.columns.map {
                    if (it is CalculatedModelColumn) it.copy(formula = it.formula.replace("*2", "+2")) else it
                }) })
                assertFalse(calculatedTransitionIsValid(renamed, forgedOperator))
            }
        }
    }
    @Test
    fun `row reorder retains prior instances and rejects freshly rebound existing rows`() {
        val before = transitionWorkbook(anchored = true)
        val sheet = before.sheetsInOrder.first()
        val reordered = before.replaceSheet(sheet.copy(content = TabularContent(
            sheet.tabularContent.rows.reversed(), sheet.tabularContent.columns, sheet.tabularContent.cellContents,
        )))

        assertTrue(calculatedTransitionIsValid(before, reordered))
        assertFalse(calculatedTransitionIsValid(before, freshlyInstantiated(reordered)))
        assertEquals(reordered, materializeDerivedContents(reordered))
    }

    @Test
    fun `deleted anchored target remains retained through lifecycle retry and same-state whole save`() = withSqliteStore { store ->
        val before = transitionWorkbook(anchored = true)
        store.saveWorkbook(before)
        val sheet = before.sheetsInOrder.first()
        val removed = sheet.tabularContent.rows.first()
        val after = before.replaceSheet(sheet.copy(presentation = SheetPresentation(), content = TabularContent(
            sheet.tabularContent.rows.drop(1), sheet.tabularContent.columns,
            sheet.tabularContent.cellContents.filterKeys { it.rowId != removed },
        )))
        val application = DefaultWorkbookApplication(store)

        val saved = application.saveModelLifecycle(before, after)

        assertEquals(after.documents.getValue(sheet.id).tabularContent, saved.documents.getValue(sheet.id).tabularContent)
        assertEquals(saved, application.saveModelLifecycle(before, after))
        store.saveWorkbook(saved)
        assertEquals(saved, store.loadWorkbookBundle())
        assertFalse(calculatedContentsAreDerived(saved))
        assertFalse(calculatedTransitionIsValid(before, freshlyInstantiated(after)))
    }

    @Test
    fun `appended row uses final positions while every surviving output remains byte identical`() = withSqliteStore { store ->
        val before = transitionWorkbook()
        store.saveWorkbook(before)
        val sheet = before.sheetsInOrder.first()
        val row = RowId.generate()
        val withRow = before.replaceSheet(sheet.copy(content = TabularContent(
            listOf(row) + sheet.tabularContent.rows, sheet.tabularContent.columns, sheet.tabularContent.cellContents,
        )))
        val after = materializeDerivedContents(withRow)

        val saved = DefaultWorkbookApplication(store).saveModelLifecycle(before, after)

        assertEquals(sheet.tabularContent.cellContents, saved.documents.getValue(sheet.id).tabularContent.cellContents.filterKeys { it.rowId != row })
        val template = sheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT)
        val coordinate = CellCoordinate(row, sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT))
        assertEquals(derivedFormulaRaw(template, after, 0, "=@A[1]*2", sheet.id.value), saved.documents.getValue(sheet.id).tabularContent.cellContents[coordinate])
    }

    @Test
    fun `template and output cotampering cannot reset an unchanged declaration even with zero output rows`() = withSqliteStore { store ->
        val before = transitionWorkbook()
        store.saveWorkbook(before)
        val sheet = before.sheetsInOrder.first()
        val template = sheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT)
        val forged = template.copy(content = template.content.replace(sheet.tabularContent.rows.first().value, sheet.tabularContent.rows.last().value))
        val tampered = freshlyInstantiated(before.replaceSheet(sheet.copy(modelFormulaBindings = mapOf(LIFECYCLE_OUTPUT to forged))))

        listOf(tampered, tampered.replaceSheet(tampered.documents.getValue(sheet.id).copy(
            content = TabularContent(emptyList(), sheet.tabularContent.columns, emptyMap()),
        ))).forEach { after ->
            assertFalse(calculatedTransitionIsValid(before, after))
            assertRejectedWithoutPersisting<WorkbookApplicationException>(store) { store.updateWorkbook { after } }
            assertRejectedWithoutPersisting<WorkbookApplicationException>(store) { store.saveWorkbook(after) }
        }
    }

    @Test
    fun `actual formula changes regenerate instances but declaration renames retain prior instances`() {
        val before = transitionWorkbook()
        val model = before.dataModels.getValue(LIFECYCLE_MODEL)
        val renamed = before.copy(dataModels = before.dataModels + (model.id to model.copy(name = "Renamed", columns = model.columns.map {
            if (it is CalculatedModelColumn) it.copy(name = "Renamed output") else it
        })))
        val changed = renamed.copy(dataModels = renamed.dataModels.mapValues { (_, value) -> value.copy(columns = value.columns.map {
            if (it is CalculatedModelColumn) it.copy(formula = "=@A[1]*3") else it
        }) }, documents = renamed.documents.mapValues { (_, sheet) -> sheet.copy(modelFormulaBindings = sheet.modelFormulaBindings!!.mapValues { (_, template) ->
            template.copy(content = template.content.replace("*2", "*3"))
        }) })

        assertTrue(calculatedTransitionIsValid(before, renamed))
        assertFalse(calculatedTransitionIsValid(before, changed))
        assertTrue(calculatedTransitionIsValid(before, freshlyInstantiated(changed)))
    }

    @Test
    fun `missing prior instances never authorize a replacement and missing new instances fail`() {
        val before = transitionWorkbook()
        val sheet = before.sheetsInOrder.first()
        val coordinate = CellCoordinate(sheet.tabularContent.rows.first(), sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT))
        val missing = before.replaceSheet(sheet.copy(content = TabularContent(
            sheet.tabularContent.rows, sheet.tabularContent.columns, sheet.tabularContent.cellContents - coordinate,
        )))

        assertFalse(calculatedTransitionIsValid(missing, before))
        assertFalse(calculatedTransitionIsValid(missing, missing))
        assertFalse(calculatedTransitionIsValid(emptyWorkbookState(), missing))
        assertTrue(calculatedTransitionIsValid(emptyWorkbookState(), before))
        val partiallyBound = before.copy(documents = before.documents.mapValues { (_, document) -> document.copy(
            modelColumnBindings = document.modelColumnBindings - LIFECYCLE_OUTPUT, modelFormulaBindings = emptyMap(),
        ) })
        assertTrue(calculatedTransitionIsValid(emptyWorkbookState(), partiallyBound))
        assertTrue(calculatedTransitionIsValid(partiallyBound, before))
    }

    @Test
    fun `new sheets and newly calculated properties require exact fresh instances`() {
        val after = transitionWorkbook()
        val sheet = after.sheetsInOrder.first()
        val unbound = after.replaceSheet(sheet.copy(modelId = null, modelColumnBindings = emptyMap(), modelFormulaBindings = null))
        val withoutTemplate = after.replaceSheet(sheet.copy(modelFormulaBindings = null))
        val model = after.dataModels.getValue(LIFECYCLE_MODEL)
        val manual = after.copy(dataModels = after.dataModels + (model.id to model.copy(columns = model.columns.map {
            if (it is CalculatedModelColumn) ManualModelColumn(it.id, it.name, it.type) else it
        })), documents = after.documents.mapValues { (_, document) -> document.copy(modelFormulaBindings = emptyMap()) })
        val withoutProperty = after.copy(
            dataModels = after.dataModels + (model.id to model.copy(columns = model.columns.filterNot { it.id == LIFECYCLE_OUTPUT })),
            documents = after.documents.mapValues { (_, document) -> document.copy(
                modelColumnBindings = document.modelColumnBindings - LIFECYCLE_OUTPUT, modelFormulaBindings = emptyMap(),
            ) },
        )

        assertTrue(calculatedTransitionIsValid(after.removeSheet(sheet.id), after))
        assertTrue(calculatedTransitionIsValid(unbound, after))
        assertTrue(calculatedTransitionIsValid(manual, after))
        assertTrue(calculatedTransitionIsValid(withoutProperty, after))
        assertFalse(calculatedTransitionIsValid(withoutTemplate, after))
        assertTrue(calculatedTransitionIsValid(after, unbound))
    }

    @Test
    fun `retained historical identities survive SQLite reopen but cannot seed an empty store`() {
        val path = Files.createTempFile("sheetspace-calculated-transition", ".sqlite")
        try {
            val before = transitionWorkbook(anchored = true)
            val sheet = before.sheetsInOrder.first()
            val after = before.replaceSheet(sheet.copy(content = TabularContent(
                sheet.tabularContent.rows.reversed(), sheet.tabularContent.columns, sheet.tabularContent.cellContents,
            )))
            val saved = SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(before)
                DefaultWorkbookApplication(store).saveModelLifecycle(before, after)
            }

            SqliteWorkbookStore(path).use { store ->
                assertEquals(saved, store.loadWorkbookBundle())
                store.saveWorkbook(saved)
                assertEquals(saved, store.loadWorkbookBundle())
                assertRejectedWithoutPersisting<WorkbookApplicationException>(store) { store.saveWorkbook(freshlyInstantiated(saved)) }
            }
            withSqliteStore { store ->
                assertRejectedWithoutPersisting<WorkbookApplicationException>(store) { store.saveWorkbook(saved) }
            }
        } finally {
            Files.deleteIfExists(path)
        }
    }
}

private fun transitionWorkbook(anchored: Boolean = false): WorkbookState {
    val base = lifecycleBoundWorkbook(lifecycleWorkbook())
    if (!anchored) return freshlyInstantiated(base)
    val formula = "=@A[$1]*2"
    return freshlyInstantiated(base.copy(
        dataModels = base.dataModels.mapValues { (_, model) -> model.copy(columns = model.columns.map {
            if (it is CalculatedModelColumn) it.copy(formula = formula) else it
        }) },
        documents = base.documents.mapValues { (_, sheet) -> sheet.copy(modelFormulaBindings = sheet.modelFormulaBindings!!.mapValues { (_, _) ->
            lifecycleTemplate(sheet, sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT), formula, anchored = true)
        }) },
    ))
}

private fun freshlyInstantiated(workbook: WorkbookState): WorkbookState = workbook.copy(documents = workbook.documents.mapValues { (_, sheet) ->
    val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
    val template = sheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT)
    val contents = sheet.tabularContent.cellContents.toMutableMap()
    val declaration = (workbook.dataModels.getValue(LIFECYCLE_MODEL).columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn).formula
    sheet.tabularContent.rows.forEachIndexed { index, row -> contents[CellCoordinate(row, output)] = derivedFormulaRaw(template, workbook, index, declaration, sheet.id.value) }
    sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents))
})
