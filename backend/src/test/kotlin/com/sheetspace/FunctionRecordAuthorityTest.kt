package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class FunctionRecordAuthorityTest {
    private fun define(workbook: WorkbookState, name: String, body: String, parameters: List<CustomFunctionParameter> = emptyList()): WorkbookState =
        workbook.copy(functions = assertNotNull(SharedFunctionAdmission.set(workbook, CustomFunction(name, parameters, body), null)))

    @Test
    fun `record admission evaluates nested functions in calculated cells with current definitions`() {
        SqliteWorkbookStore.inMemory().use { store ->
            var workbook = lifecycleBoundWorkbook(lifecycleWorkbook())
            workbook = workbook.removeSheet(workbook.sheetsInOrder.last().id)
            workbook = define(workbook, "inner", "=@x*2", listOf(CustomFunctionParameter("x", "float")))
            workbook = define(workbook, "outer", "=inner(@x)+1", listOf(CustomFunctionParameter("x", "float")))
            val sheet = workbook.sheetsInOrder.first()
            val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
            val first = sheet.tabularContent.rows.first()
            val declaration = "=outer(@A[1])"
            val model = workbook.dataModels.getValue(LIFECYCLE_MODEL)
            workbook = workbook.copy(dataModels = workbook.dataModels + (model.id to model.copy(columns = model.columns.map {
                if (it.id == LIFECYCLE_OUTPUT) CalculatedModelColumn(it.id, it.name, ModelColumnType.FLOAT, declaration) else it
            })))
            val template = lifecycleTemplate(sheet, sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT), declaration)
            val content = sheet.tabularContent.rows.indices.fold(sheet.tabularContent) { current, index ->
                current.updateCell("B${index + 1}", instantiateStoredModelFormula(template.content, declaration, sheet.id.value, index) { sheet.tabularContent.rows.map { it.value } })
            }
            workbook = workbook.replaceSheet(sheet.copy(content = content, modelFormulaBindings = mapOf(LIFECYCLE_OUTPUT to template)))
            val expression = "=@${output.value}[${first.value}]"
            assertTrue(SharedRecordValueValidation.valid(workbook, sheet.id, mapOf(LIFECYCLE_INPUT to expression)))
            assertFalse(SharedRecordValueValidation.valid(workbook, sheet.id, mapOf(LIFECYCLE_INPUT to "=outer(\"bad\")")))
            assertFalse(SharedRecordValueValidation.valid(workbook, sheet.id, mapOf(LIFECYCLE_INPUT to "=outer()")))
            store.saveWorkbook(workbook)
            val result = DefaultWorkbookApplication(store).admitRecord(sheet.id.value, sheet.revision, RowId.generate().value, mapOf(LIFECYCLE_INPUT to expression), WorkbookReadTransportAdapter.bundle(workbook))
            assertEquals(3, result.sheet.tabularContent.rowCount)
            val changed = workbook.copy(functions = workbook.functions.map { if (it.name == "inner") it.copy(body = "=1/0", bodyBindings = emptyMap()) else it })
            assertFalse(SharedRecordValueValidation.valid(changed, sheet.id, mapOf(LIFECYCLE_INPUT to expression)))
            assertFalse(SharedRecordValueValidation.valid(workbook.copy(functions = emptyList()), sheet.id, mapOf(LIFECYCLE_INPUT to expression)))
        }
    }

    @Test
    fun `authoritative binding retains original row identity after reorder`() {
        var workbook = lifecycleBoundWorkbook(lifecycleWorkbook())
        val sheet = workbook.sheetsInOrder.first()
        workbook = define(workbook, "firstvalue", "=@A[1]")
        val binding = workbook.functions.single().bodyBindings.getValue(sheet.id.value)
        val rows = sheet.tabularContent.rows
        val changed = sheet.copy(content = TabularContent(rows.reversed(), sheet.tabularContent.columns, sheet.tabularContent.cellContents))
        workbook = workbook.replaceSheet(changed)
        assertEquals("=@A[1]", workbook.functions.single().body)
        assertEquals(binding, workbook.functions.single().bodyBindings.getValue(sheet.id.value))
        assertTrue(SharedRecordValueValidation.valid(workbook, sheet.id, mapOf(LIFECYCLE_INPUT to "=1/firstvalue()")))
        val unbound = workbook.copy(functions = workbook.functions.map { it.copy(bodyBindings = emptyMap()) })
        assertFalse(SharedRecordValueValidation.valid(unbound, sheet.id, mapOf(LIFECYCLE_INPUT to "=1/firstvalue()")))
    }
}
