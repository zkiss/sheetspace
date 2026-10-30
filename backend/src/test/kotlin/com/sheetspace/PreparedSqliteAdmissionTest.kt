package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class PreparedSqliteAdmissionTest {
    @Test
    fun `persisted same declaration provenance cannot be replaced even with matching forged outputs`() {
        val fixture = Json.parseToJsonElement(requireNotNull(javaClass.getResource("/stored-model-instances.json")).readText()).jsonArray.first().jsonObject
        val template = PreparedModelFormula(fixture.getValue("template").jsonPrimitive.content)
        val forgedTemplate = PreparedModelFormula(template.content.replace("col1", "other-column"))
        val declaration = "=@A[1]:B[2]+???😀"
        assertTrue(preparedModelTemplateIsValid(template, declaration))
        assertTrue(preparedModelTemplateIsValid(forgedTemplate, declaration))
        for (empty in listOf(false, true)) {
            val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
            val base = initial.removeSheet(initial.sheetsInOrder.last().id)
            val sheet = base.sheetsInOrder.first()
            val model = base.dataModels.getValue(LIFECYCLE_MODEL)
            val changedModel = model.copy(columns = model.columns.map {
                if (it.id == LIFECYCLE_OUTPUT) (it as CalculatedModelColumn).copy(formula = declaration) else it
            })
            val rules = preparedCalculatedTemplates { candidate ->
                if (candidate.id == sheet.id) mapOf(LIFECYCLE_OUTPUT to if (candidate.name == "forged") forgedTemplate else template) else null
            }
            val rows = if (empty) emptyList() else sheet.tabularContent.rows
            val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
            val workbook = base.copy(dataModels = base.dataModels + (model.id to changedModel))
            fun contents(value: PreparedModelFormula) = rows.withIndex().associate { (index, row) ->
                CellCoordinate(row, output) to derivedPreparedFormulaRaw(value, workbook, index, declaration, sheet.id.value)
            }
            val before = workbook.replaceSheet(sheet.copy(presentation = SheetPresentation(), content = TabularContent(rows, sheet.tabularContent.columns, contents(template))))
            SqliteWorkbookStore.inMemory(calculatedAdmission = { current, updated -> rejectCalculatedOverrides(current, updated, rules) }).use { store ->
                store.saveWorkbook(before)
                val persisted = store.loadWorkbookBundle()
                val saved = persisted.documents.getValue(sheet.id)
                val forged = persisted.replaceSheet(saved.copy(name = "forged", content = TabularContent(rows, saved.tabularContent.columns, contents(forgedTemplate))))
                assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(forged) }
                assertFailsWith<WorkbookApplicationException> { store.updateWorkbook(null) { forged } }
                assertEquals(persisted, store.loadWorkbookBundle())
            }
        }
    }
    @Test
    fun `persisted missing history and forged templates cannot authorize calculated output`() {
        val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
        val base = initial.removeSheet(initial.sheetsInOrder.last().id)
        val sheet = base.sheetsInOrder.first()
        val property = base.dataModels.getValue(LIFECYCLE_MODEL).columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn
        val template = PreparedModelFormula(property.formula)
        val forgedTemplate = PreparedModelFormula(property.formula + " ")
        val rules = preparedCalculatedTemplates { candidate ->
            if (candidate.id != sheet.id) null else mapOf(LIFECYCLE_OUTPUT to if (candidate.name == "forged") forgedTemplate else template)
        }
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val contents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, base, index, template.content, sheet.id.value)
        }
        val missing = base.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, emptyMap())))
        val restored = base.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents)))
        var enforce = false
        SqliteWorkbookStore.inMemory(calculatedAdmission = { current, updated ->
            if (enforce) rejectCalculatedOverrides(current, updated, rules)
        }).use { store ->
            store.saveWorkbook(missing)
            enforce = true
            val persisted = store.loadWorkbookBundle()
            assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(restored) }
            assertFailsWith<WorkbookApplicationException> { store.updateWorkbook(null) { restored } }
            assertEquals(persisted, store.loadWorkbookBundle())
            val forged = persisted.replaceSheet(persisted.documents.getValue(sheet.id).copy(name = "forged"))
            assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(forged) }
            assertFailsWith<WorkbookApplicationException> { store.updateWorkbook(null) { forged } }
            assertEquals(persisted, store.loadWorkbookBundle())
        }
    }

    @Test
    fun `both persistence boundaries authorize prepared content against reloaded history`() {
        val initial = lifecycleBoundWorkbook(lifecycleWorkbook())
        val base = initial.removeSheet(initial.sheetsInOrder.last().id)
        val sheet = base.sheetsInOrder.first()
        val declaration = (base.dataModels.getValue(LIFECYCLE_MODEL).columns.single { it.id == LIFECYCLE_OUTPUT } as CalculatedModelColumn).formula
        val template = PreparedModelFormula(declaration)
        val rules = preparedCalculatedTemplates { candidate ->
            if (candidate.id == sheet.id) mapOf(LIFECYCLE_OUTPUT to template) else null
        }
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
        val contents = sheet.tabularContent.rows.withIndex().associate { (index, row) ->
            CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, base, index, template.content, sheet.id.value)
        }
        val before = base.replaceSheet(sheet.copy(content = TabularContent(sheet.tabularContent.rows, sheet.tabularContent.columns, contents)))
        SqliteWorkbookStore.inMemory(calculatedAdmission = { current, updated ->
            rejectCalculatedOverrides(current, updated, rules)
        }).use { store ->
            store.saveWorkbook(before)
            val persisted = store.loadWorkbookBundle()
            val savedSheet = persisted.documents.getValue(sheet.id)
            val forged = persisted.replaceSheet(savedSheet.copy(content = TabularContent(
                savedSheet.tabularContent.rows, savedSheet.tabularContent.columns, emptyMap(),
            )))
            assertFailsWith<WorkbookApplicationException> { store.saveWorkbook(forged) }
            assertFailsWith<WorkbookApplicationException> { store.updateWorkbook(null) { forged } }
            assertEquals(persisted, store.loadWorkbookBundle())

            val moved = persisted.replaceSheet(savedSheet.copy(content = TabularContent(
                savedSheet.tabularContent.rows.reversed(), savedSheet.tabularContent.columns, savedSheet.tabularContent.cellContents,
            )))
            store.saveWorkbook(moved)
            val row = RowId.generate()
            val updated = store.updateWorkbook(null) { current ->
                val currentSheet = current.documents.getValue(sheet.id)
                current.replaceSheet(currentSheet.copy(content = TabularContent(
                    currentSheet.tabularContent.rows + row, currentSheet.tabularContent.columns,
                    currentSheet.tabularContent.cellContents +
                        (CellCoordinate(row, output) to derivedPreparedFormulaRaw(template, current, currentSheet.tabularContent.rows.size, declaration, sheet.id.value)),
                )))
            }
            assertEquals(contents, updated.documents.getValue(sheet.id).tabularContent.cellContents - CellCoordinate(row, output))
        }
    }
}
