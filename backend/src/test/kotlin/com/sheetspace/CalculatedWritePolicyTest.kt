package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonPrimitive

/** Canonical property-target text, encoding every UTF-16 code unit as four hexadecimal digits. */
internal fun namedCanonicalEndpoint(propertyId: String, columnId: String, rowId: String): String =
    "~${propertyId.encodeStableId()}~${columnId.encodeStableId()}[${rowId.encodeStableId()}]"

private fun String.encodeStableId(): String = map { it.code.toString(16).padStart(4, '0') }.joinToString("")

class CalculatedWritePolicyTest {
    private val modelId = "10000000-0000-0000-0000-000000000001"
    private val inputId = "10000000-0000-0000-0000-000000000002"
    private val outputId = "10000000-0000-0000-0000-000000000003"
    private val sheetId = "10000000-0000-0000-0000-000000000004"

    @Test
    fun `calculated ownership follows the current declaration and the persisted derived instance`() {
        val base = workbook()
        val sheet = base.documents.getValue(SheetId(sheetId))
        val row = sheet.tabularContent.rows.single()
        val output = sheet.modelColumnBindings.getValue(outputId)

        assertEquals(setOf(output), calculatedModelColumns(sheet, base.dataModels))
        assertEquals(
            instantiateStoredModelFormula(sheet.modelFormulaBindings!!.getValue(outputId).content, 0) { sheet.tabularContent.rows.map { it.value } },
            sheet.tabularContent.cellContents.getValue(CellCoordinate(row, output)),
        )
        assertTrue(calculatedContentsAreDerived(base))

        val stale = base.replaceSheet(sheet.updateTabularContent { it.updateCell("B1", "=0") })
        assertFalse(calculatedContentsAreDerived(stale))

        val changedDeclaration = base.copy(dataModels = base.dataModels.mapValues { (_, model) ->
            model.copy(columns = listOf(model.columns[0], (model.columns[1] as CalculatedModelColumn).copy(formula = "=3")))
        })
        assertFalse(calculatedContentsAreDerived(changedDeclaration))

        val missingTemplates = base.replaceSheet(sheet.copy(modelFormulaBindings = null))
        assertFalse(calculatedContentsAreDerived(missingTemplates))

        val incompleteTemplates = base.replaceSheet(sheet.copy(modelFormulaBindings = emptyMap()))
        assertFalse(calculatedContentsAreDerived(incompleteTemplates))

        val unbound = sheet.copy(modelId = null, modelColumnBindings = emptyMap(), modelFormulaBindings = null)
        assertTrue(calculatedModelColumns(unbound, base.dataModels).isEmpty())
        assertTrue(calculatedContentsAreDerived(base.replaceSheet(unbound)))

        val unboundColumns = sheet.copy(modelColumnBindings = emptyMap())
        assertTrue(calculatedModelColumns(unboundColumns, base.dataModels).isEmpty())
    }

    @Test
    fun `an appended row is materialized from the persisted template and requires one`() {
        val base = workbook()
        val sheet = base.documents.getValue(SheetId(sheetId))
        val appended = sheet.updateTabularContent { it.appendRow() }
        val appendedRow = appended.tabularContent.rows.last()

        val materialized = materializeCalculatedRow(base.replaceSheet(appended), appended, appendedRow)

        assertEquals(
            instantiateStoredModelFormula(appended.modelFormulaBindings!!.getValue(outputId).content, 1) { appended.tabularContent.rows.map { it.value } },
            materialized.tabularContent.cellContents.getValue(CellCoordinate(appendedRow, appended.modelColumnBindings.getValue(outputId))),
        )
        val instance = StoredFormulaCodec.decode(materialized.tabularContent.cellContents.getValue(CellCoordinate(appendedRow, appended.modelColumnBindings.getValue(outputId))))
        assertEquals("=@A[1]*2", instance.text)
        assertEquals(listOf(appendedRow.value), instance.occurrences.single().slots.single { it.id == "r" }.targetIds)
        assertTrue(calculatedContentsAreDerived(base.replaceSheet(materialized)))

        val withoutTemplate = base.replaceSheet(appended.copy(modelFormulaBindings = null))
        val rejected = assertFailsWith<WorkbookApplicationException> {
            materializeCalculatedRow(withoutTemplate, withoutTemplate.documents.getValue(SheetId(sheetId)), appendedRow)
        }
        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejected.error)

        val manualOnly = appended.copy(modelColumnBindings = mapOf(inputId to appended.tabularContent.columns[0]))
        assertEquals(manualOnly, materializeCalculatedRow(base.replaceSheet(manualOnly), manualOnly, appendedRow))
    }

    @Test
    fun `derived instances retain property identities and row recipes`() {
        val workbook = propertyTargetWorkbook()
        val template = propertyTargetTemplate()
        val rows = workbook.documents.getValue(SheetId("s")).tabularContent.rows.map { it.value }
        val instance = StoredFormulaCodec.decode(instantiateStoredModelFormula(template.content, 0) { rows })

        assertEquals("=@p[1]", instance.text)
        assertEquals(listOf("p", "c"), instance.occurrences.single().slots.single { it.kind == "property" }.targetIds)
        assertEquals(listOf("r"), instance.occurrences.single().slots.single { it.kind == "row" }.targetIds)
        val missingRow = StoredFormulaCodec.decode(instantiateStoredModelFormula(template.content, 1) { rows })
        assertEquals("unresolved", missingRow.occurrences.single().slots.single { it.kind == "row" }.status)
        assertEquals(listOf("p", "c"), missingRow.occurrences.single().slots.single { it.kind == "property" }.targetIds)
    }

    private fun propertyTargetWorkbook(): WorkbookState {
        val sheet = SheetDocument(
            SheetId("s"),
            name = "Property",
            content = TabularContent(listOf(RowId("r")), listOf(ColumnId("c")), emptyMap()),
            modelId = "m",
            modelColumnBindings = mapOf("p" to ColumnId("c")),
        )
        return emptyWorkbookState().addSheet(sheet).copy(
            dataModels = mapOf("m" to DataModel("m", "Property", listOf(ManualModelColumn("p", "Input", ModelColumnType.FLOAT)))),
        )
    }

    private fun propertyTargetTemplate(): BoundModelFormula = BoundModelFormula(StoredFormulaCodec.encode(StoredFormula(
        "=@p[1]", listOf(FormulaOccurrence(
            "o", FormulaSpan(1, 6), "s", listOf(FormulaEndpoint("e", "p", "r", false, false)),
            listOf(
                FormulaSlot("s", "sheet", JsonPrimitive("Property"), "retained", listOf("s")),
                FormulaSlot("p", "property", JsonPrimitive("p"), "retained", listOf("p", "c")),
                FormulaSlot("r", "row", JsonPrimitive(1), "retained", listOf("r")),
            ), listOf(FormulaOrigin(1, 2, null), FormulaOrigin(2, 3, "p"), FormulaOrigin(3, 4, null),
                FormulaOrigin(4, 5, "r"), FormulaOrigin(5, 6, null)),
        )),
    )))

    private fun workbook(): WorkbookState {
        val content = TabularContent(rowCount = 1, columnCount = 2)
        val sheet = SheetDocument(
            SheetId(sheetId),
            name = "Policy",
            content = content,
            modelId = modelId,
            modelColumnBindings = mapOf(inputId to content.columns[0], outputId to content.columns[1]),
        )
        val template = lifecycleTemplate(sheet, content.columns[0], "=@A[1]*2")
        val derived = sheet.copy(modelFormulaBindings = mapOf(outputId to template)).updateTabularContent {
            it.updateCell("B1", instantiateStoredModelFormula(template.content, 0) { content.rows.map { row -> row.value } })
        }
        return emptyWorkbookState().addSheet(derived).copy(dataModels = mapOf(modelId to DataModel(
            modelId,
            "Policy",
            listOf(ManualModelColumn(inputId, "Input", ModelColumnType.FLOAT), CalculatedModelColumn(outputId, "Output", ModelColumnType.FLOAT, "=@A[1]*2")),
        )))
    }
}
