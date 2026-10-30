package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

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
    fun `derived instances use the canonical property form for property targets`() {
        val workbook = propertyTargetWorkbook()
        val template = propertyTargetTemplate()

        assertEquals("=@~0070~0063[0072]", derivedFormulaRaw(template, workbook, 0))
        assertEquals(
            "=@\$~0070~0063[\$0072]",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(anchors = ModelFormulaAnchors(true, true)) })
                }),
                workbook,
                0,
            ),
        )
        assertEquals(
            "=@c[r]",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(propertyId = null) })
                }),
                workbook,
                0,
            ),
        )
        assertEquals(
            "=@\$c[\$r]",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint ->
                        endpoint!!.copy(propertyId = null, anchors = ModelFormulaAnchors(true, true))
                    })
                }),
                workbook,
                0,
            ),
        )
        assertEquals(
            "=@#REF!A[1]",
            derivedFormulaRaw(
                template.copy(references = template.references.map { reference ->
                    reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(rowIndex = 1.5) })
                }),
                workbook,
                0,
            ),
        )
        assertEquals(
            "=@#REF!A[1]",
            derivedFormulaRaw(template, workbook.copy(dataModels = emptyMap()), 0),
        )
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

    private fun propertyTargetTemplate(): BoundModelFormula = BoundModelFormula(
        "=@p[1]",
        listOf(
            ModelFormulaReference(
                ModelFormulaSpan(1, 6),
                "s",
                endpoints = listOf(ModelFormulaEndpoint(ModelFormulaSpan(2, 6), "c", 0.0, ModelFormulaAnchors(false, false), "p")),
            ),
        ),
    )

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
