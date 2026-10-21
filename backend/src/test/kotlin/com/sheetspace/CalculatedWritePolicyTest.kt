package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
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
    fun `derived write policy accepts only current calculated template instances`() {
        val base = workbook()
        val sheet = base.documents.getValue(SheetId(sheetId))
        val row = sheet.tabularContent.rows.single().value
        val output = sheet.tabularContent.columns[1].value

        assertTrue(isDerivedCalculatedWrite(base, sheet, SheetCellWrite(sheetId, row, output, "=@${sheet.tabularContent.columns[0].value}[$row]*2")))
        assertTrue(isDerivedCalculatedWrite(base, sheet, SheetCellWrite(sheetId, row, output, "=@${sheet.tabularContent.columns[0].value}[$row]*2")))
        assertFalse(isDerivedCalculatedWrite(base, sheet, SheetCellWrite(sheetId, row, output, "=0")))
        assertFalse(isDerivedCalculatedWrite(base, sheet, SheetCellWrite(sheetId, "10000000-0000-0000-0000-000000000099", output, "=@A[1]*2")))
        assertFalse(isDerivedCalculatedWrite(base, sheet.copy(modelFormulaBindings = null), SheetCellWrite(sheetId, row, output, "=@A[1]*2")))
        assertFalse(isDerivedCalculatedWrite(base.copy(dataModels = emptyMap()), sheet, SheetCellWrite(sheetId, row, output, "=@A[1]*2")))
        assertFalse(isDerivedCalculatedWrite(base, sheet, SheetCellWrite(sheetId, row, sheet.tabularContent.columns[0].value, "=@A[1]*2")))
        assertFalse(isDerivedCalculatedWrite(base, sheet.copy(modelId = null), SheetCellWrite(sheetId, row, output, "=@A[1]*2")))
        assertFalse(isDerivedCalculatedWrite(base.copy(dataModels = base.dataModels.mapValues { (_, model) ->
            model.copy(columns = listOf(model.columns[0], (model.columns[1] as CalculatedModelColumn).copy(formula = "=3")))
        }), sheet, SheetCellWrite(sheetId, row, output, "=@A[1]*2")))
        assertTrue(calculatedModelColumns(sheet, base.dataModels).contains(ColumnId(output)))
        assertTrue(calculatedModelColumns(sheet.copy(modelId = null), base.dataModels).isEmpty())
        val anchored = sheet.copy(modelFormulaBindings = sheet.modelFormulaBindings!!.mapValues { (_, template) ->
            template.copy(references = template.references.map { reference -> reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(anchors = ModelFormulaAnchors(true, true)) }) })
        })
        val anchoredWorkbook = base.replaceSheet(anchored)
        assertTrue(isDerivedCalculatedWrite(anchoredWorkbook, anchored, SheetCellWrite(sheetId, row, output, "=@\$${sheet.tabularContent.columns[0].value}[\$${row}]*2")))
        val missingTarget = sheet.copy(modelFormulaBindings = sheet.modelFormulaBindings!!.mapValues { (_, template) ->
            template.copy(references = template.references.map { reference -> reference.copy(endpoints = listOf(null)) })
        })
        assertTrue(isDerivedCalculatedWrite(base.replaceSheet(missingTarget), missingTarget, SheetCellWrite(sheetId, row, output, "=@#REF!A[1]*2")))
        val outOfRange = sheet.copy(modelFormulaBindings = sheet.modelFormulaBindings!!.mapValues { (_, template) ->
            template.copy(references = template.references.map { reference -> reference.copy(endpoints = reference.endpoints.map { endpoint -> endpoint!!.copy(rowIndex = 9.0) }) })
        })
        assertTrue(isDerivedCalculatedWrite(base.replaceSheet(outOfRange), outOfRange, SheetCellWrite(sheetId, row, output, "=@#REF!A[1]*2")))
        assertTrue(calculatedModelColumns(sheet.copy(modelColumnBindings = emptyMap()), base.dataModels).isEmpty())
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
            modelFormulaBindings = mapOf(outputId to BoundModelFormula(
                "=@A[1]*2",
                listOf(ModelFormulaReference(ModelFormulaSpan(1, 6), sheetId, endpoints = listOf(ModelFormulaEndpoint(ModelFormulaSpan(2, 6), content.columns[0].value, 0.0, ModelFormulaAnchors(false, false))))),
            )),
        )
        return emptyWorkbookState().addSheet(sheet).copy(dataModels = mapOf(modelId to DataModel(
            modelId,
            "Policy",
            listOf(ManualModelColumn(inputId, "Input", ModelColumnType.FLOAT), CalculatedModelColumn(outputId, "Output", ModelColumnType.FLOAT, "=@A[1]*2")),
        )))
    }
}
