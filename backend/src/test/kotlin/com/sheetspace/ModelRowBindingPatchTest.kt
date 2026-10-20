package com.sheetspace

import io.ktor.client.request.get
import io.ktor.client.request.patch
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.nio.file.Files
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val ROW_MODEL = "30000000-0000-0000-0000-000000000001"
private const val ROW_INPUT = "31000000-0000-0000-0000-000000000001"
private const val ROW_OUTPUT = "31000000-0000-0000-0000-000000000002"
private const val ROW_TEMPLATE = "=@A[1]*2"

private fun instantiatedRowFormula(inputColumn: String, row: String) = "=@$inputColumn[$row]*2"

private fun rowWorkbook(sheetId: String): WorkbookState {
    val model = DataModel(
        ROW_MODEL,
        "Ledger",
        listOf(ManualModelColumn(ROW_INPUT, "Input", ModelColumnType.FLOAT), CalculatedModelColumn(ROW_OUTPUT, "Output", ModelColumnType.FLOAT, ROW_TEMPLATE)),
    )
    val sheet = SheetDocument(
        id = SheetId(sheetId),
        name = "One",
        content = TabularContent(rowCount = 1, columnCount = 2, cells = mapOf("A1" to "3")),
    )
    return emptyWorkbookState().addSheet(sheet).copy(dataModels = mapOf(model.id to model))
}

private fun rowTemplate(sheetId: String, columnId: String): BoundModelFormula = BoundModelFormula(
    ROW_TEMPLATE,
    listOf(
        ModelFormulaReference(
            ModelFormulaSpan(1, 6),
            sheetId,
            endpoints = listOf(ModelFormulaEndpoint(ModelFormulaSpan(2, 6), columnId, 0.0, ModelFormulaAnchors(false, false))),
        ),
    ),
)

class ModelRowBindingPatchTest {
    @Test
    fun `ordinary HTTP patches reject calculated writes carrying claimed template bindings`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val sheetId = "40000000-0000-0000-0000-000000000001"
            store.saveWorkbook(rowWorkbook(sheetId))
            val application = DefaultWorkbookApplication(store)
            application.updateSheetModel(sheetId, UpdateSheetModelCommand(ROW_MODEL))
            val sheet = application.loadSheet(sheetId)
            val coordinate = sheet.tabularContent.coordinateAt("B1")!!
            val template = rowTemplate(sheetId, sheet.tabularContent.columns[0].value)

            testApplication {
                application { module(DefaultWorkbookApplication(store)) }
                val response = client.patch("/api/cells") {
                    jsonBody(
                        """{"expectedRevisions":[{"sheetId":"$sheetId","revision":${sheet.revision}}],"cells":[{"sheetId":"$sheetId","rowId":"${coordinate.rowId.value}","columnId":"${coordinate.columnId.value}","raw":"${instantiatedRowFormula(sheet.tabularContent.columns[0].value, coordinate.rowId.value)}"}],"modelFormulaBindings":[{"sheetId":"$sheetId","bindings":{"$ROW_OUTPUT":{}}}]}""",
                    )
                }

                assertEquals(HttpStatusCode.BadRequest, response.status)
                assertEquals(ErrorResponse("invalid-request"), response.decodeBody())
                assertNull(store.loadSheet(SheetId(sheetId))!!.modelFormulaBindings)
            }
        }
    }

    @Test
    fun `a binding that contradicts the declaration is rejected without partially writing cells`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val sheetId = "40000000-0000-0000-0000-000000000002"
            store.saveWorkbook(rowWorkbook(sheetId))
            val application = DefaultWorkbookApplication(store)
            application.updateSheetModel(sheetId, UpdateSheetModelCommand(ROW_MODEL))
            val sheet = application.loadSheet(sheetId)
            val coordinate = sheet.tabularContent.coordinateAt("B1")!!
            val stale = BoundModelFormula("=@A[1]*3", rowTemplate(sheetId, sheet.tabularContent.columns[0].value).references)
            val baseline = store.loadWorkbookBundle()

            testApplication {
                application { module(DefaultWorkbookApplication(store)) }
                val response = client.patch("/api/cells") {
                    jsonBody(testJson.encodeToString(CellPatchRequest(
                        expectedRevisions = listOf(CellRevisionRequest(sheetId, sheet.revision)),
                        cells = listOf(CellWriteRequest(sheetId, coordinate.rowId.value, coordinate.columnId.value, instantiatedRowFormula(sheet.tabularContent.columns[0].value, coordinate.rowId.value))),
                    )))
                }

                assertEquals(HttpStatusCode.BadRequest, response.status)
                assertEquals(ErrorResponse("calculated-cell-write"), response.decodeBody())
                assertEquals(baseline, store.loadWorkbookBundle())
            }
        }
    }

    @Test
    fun `ordinary HTTP writes cannot resubmit an existing derived calculation`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val sheetId = "40000000-0000-0000-0000-000000000009"
            store.saveWorkbook(rowWorkbook(sheetId))
            val application = DefaultWorkbookApplication(store)
            application.updateSheetModel(sheetId, UpdateSheetModelCommand(ROW_MODEL))
            val sheet = application.loadSheet(sheetId)
            val row = sheet.tabularContent.rows.single()
            val input = sheet.tabularContent.columns[0]
            val output = sheet.tabularContent.columns[1]
            val formula = instantiatedRowFormula(input.value, row.value)
            val template = rowTemplate(sheetId, input.value)
            store.updateWorkbook { current -> applyModelRowPatch(current, ModelRowPatchCommand(
                listOf(ExpectedSheetRevision(sheetId, sheet.revision)),
                listOf(SheetCellWrite(sheetId, row.value, output.value, formula)),
                listOf(SheetFormulaBindingWrite(sheetId, mapOf(ROW_OUTPUT to template))),
            )) }
            val baseline = store.loadWorkbookBundle()

            testApplication {
                application { module(DefaultWorkbookApplication(store)) }
                val response = client.patch("/api/cells") {
                    jsonBody(testJson.encodeToString(CellPatchRequest(
                        expectedRevisions = listOf(CellRevisionRequest(sheetId, baseline.documents.getValue(SheetId(sheetId)).revision)),
                        cells = listOf(CellWriteRequest(sheetId, row.value, output.value, formula)),
                    )))
                }

                assertEquals(HttpStatusCode.BadRequest, response.status)
                assertEquals(baseline, store.loadWorkbookBundle())
            }
        }
    }

    @Test
    fun `a stale revision conflicts and leaves the durable bindings untouched`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val sheetId = "40000000-0000-0000-0000-000000000003"
            store.saveWorkbook(rowWorkbook(sheetId))
            val application = DefaultWorkbookApplication(store)
            application.updateSheetModel(sheetId, UpdateSheetModelCommand(ROW_MODEL))
            val sheet = application.loadSheet(sheetId)
            val template = rowTemplate(sheetId, sheet.tabularContent.columns[0].value)
            store.updateWorkbook { current -> applyModelRowPatch(current, ModelRowPatchCommand(
                listOf(ExpectedSheetRevision(sheetId, sheet.revision)),
                listOf(SheetCellWrite(sheetId, sheet.tabularContent.rows[0].value, sheet.tabularContent.columns[1].value, instantiatedRowFormula(sheet.tabularContent.columns[0].value, sheet.tabularContent.rows[0].value))),
                listOf(SheetFormulaBindingWrite(sheetId, mapOf(ROW_OUTPUT to template))),
            )) }
            val baseline = store.loadWorkbookBundle()

            assertFailsWith<SheetRevisionConflict> {
                store.updateWorkbook { current -> applyModelRowPatch(current, ModelRowPatchCommand(
                    listOf(ExpectedSheetRevision(sheetId, sheet.revision)),
                    emptyList(),
                    listOf(SheetFormulaBindingWrite(sheetId, mapOf(ROW_OUTPUT to template))),
                )) }
            }
            assertEquals(baseline, store.loadWorkbookBundle())
        }
    }

    @Test
    fun `duplicate binding sheets and empty patches are rejected`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val sheetId = "40000000-0000-0000-0000-000000000004"
            store.saveWorkbook(rowWorkbook(sheetId))
            val application = DefaultWorkbookApplication(store)
            application.updateSheetModel(sheetId, UpdateSheetModelCommand(ROW_MODEL))
            val sheet = application.loadSheet(sheetId)
            val template = rowTemplate(sheetId, sheet.tabularContent.columns[0].value)
            val expected = ExpectedSheetRevision(sheetId, sheet.revision)
            val baseline = store.loadWorkbookBundle()

            val duplicate = assertFailsWith<WorkbookApplicationException> {
                store.updateWorkbook { current -> applyModelRowPatch(current, ModelRowPatchCommand(
                    listOf(expected),
                    emptyList(),
                    listOf(SheetFormulaBindingWrite(sheetId, mapOf(ROW_OUTPUT to template)), SheetFormulaBindingWrite(sheetId, mapOf(ROW_OUTPUT to template))),
                )) }
            }
            assertEquals(WorkbookApplicationError.INVALID_CELL_PATCH, duplicate.error)

            val empty = assertFailsWith<WorkbookApplicationException> {
                store.updateWorkbook { current -> applyModelRowPatch(current, ModelRowPatchCommand(listOf(expected), emptyList(), emptyList())) }
            }
            assertEquals(WorkbookApplicationError.EMPTY_CELL_PATCH, empty.error)

            assertEquals(baseline, store.loadWorkbookBundle())
        }
    }

    @Test
    fun `the row patch helper applies calculated cells and bindings while leaving other sheets alone`() {
        val sheetId = "40000000-0000-0000-0000-000000000007"
        val otherId = "40000000-0000-0000-0000-000000000008"
        val unbound = rowWorkbook(sheetId).addSheet(SheetDocument(id = SheetId(otherId), name = "Two", content = TabularContent(rowCount = 1, columnCount = 1)))
        val sheet = unbound.documents.getValue(SheetId(sheetId))
        val workbook = unbound.replaceSheet(sheet.copy(
            modelId = ROW_MODEL,
            modelColumnBindings = mapOf(ROW_INPUT to sheet.tabularContent.columns[0], ROW_OUTPUT to sheet.tabularContent.columns[1]),
        ))
        val template = rowTemplate(sheetId, sheet.tabularContent.columns[0].value)
        val row = sheet.tabularContent.rows[0].value
        val input = sheet.tabularContent.columns[0].value
        val output = sheet.tabularContent.columns[1].value

        val updated = applyModelRowPatch(workbook, ModelRowPatchCommand(
            listOf(ExpectedSheetRevision(sheetId, sheet.revision)),
            listOf(SheetCellWrite(sheetId, row, output, instantiatedRowFormula(input, row)), SheetCellWrite(sheetId, row, input, "")),
            listOf(SheetFormulaBindingWrite(sheetId, mapOf(ROW_OUTPUT to template))),
        ))

        val patched = updated.documents.getValue(SheetId(sheetId))
        assertEquals(instantiatedRowFormula(input, row), patched.tabularContent.cells.getValue("B1"))
        assertNull(patched.tabularContent.cells["A1"])
        assertEquals(mapOf(ROW_OUTPUT to template), patched.modelFormulaBindings)
        assertEquals(workbook.documents.getValue(SheetId(otherId)), updated.documents.getValue(SheetId(otherId)))
    }

    @Test
    fun `the row patch helper rejects foreign coordinates and stale revisions without mutating the workbook`() {
        val sheetId = "40000000-0000-0000-0000-000000000005"
        val unbound = rowWorkbook(sheetId)
        val sheet = unbound.documents.getValue(SheetId(sheetId))
        val workbook = unbound.replaceSheet(sheet.copy(
            modelId = ROW_MODEL,
            modelColumnBindings = mapOf(ROW_INPUT to sheet.tabularContent.columns[0], ROW_OUTPUT to sheet.tabularContent.columns[1]),
        ))
        val template = rowTemplate(sheetId, sheet.tabularContent.columns[0].value)
        val foreignRow = "40000000-0000-0000-0000-000000000099"
        val foreignColumn = "40000000-0000-0000-0000-000000000098"
        val command = ModelRowPatchCommand(
            listOf(ExpectedSheetRevision(sheetId, sheet.revision)),
            listOf(SheetCellWrite(sheetId, foreignRow, sheet.tabularContent.columns[0].value, "7")),
            listOf(SheetFormulaBindingWrite(sheetId, mapOf(ROW_OUTPUT to template))),
        )

        val rejected = assertFailsWith<WorkbookApplicationException> { applyModelRowPatch(workbook, command) }
        assertEquals(WorkbookApplicationError.INVALID_CELL_COORDINATE, rejected.error)

        val foreignColumnCommand = command.copy(cells = listOf(SheetCellWrite(sheetId, sheet.tabularContent.rows[0].value, foreignColumn, "7")))
        val rejectedColumn = assertFailsWith<WorkbookApplicationException> { applyModelRowPatch(workbook, foreignColumnCommand) }
        assertEquals(WorkbookApplicationError.INVALID_CELL_COORDINATE, rejectedColumn.error)

        val staleCommand = command.copy(expectedRevisions = listOf(ExpectedSheetRevision(sheetId, sheet.revision + 5)))
        assertFailsWith<SheetRevisionConflict> { applyModelRowPatch(workbook, staleCommand) }

        val missingSheet = command.copy(expectedRevisions = listOf(ExpectedSheetRevision("40000000-0000-0000-0000-000000000097", 0)))
        val missing = assertFailsWith<WorkbookApplicationException> { applyModelRowPatch(workbook, missingSheet) }
        assertEquals(WorkbookApplicationError.SHEET_NOT_FOUND, missing.error)

        val calculatedOverride = ModelRowPatchCommand(
            listOf(ExpectedSheetRevision(sheetId, sheet.revision)),
            listOf(SheetCellWrite(sheetId, sheet.tabularContent.rows.single().value, sheet.tabularContent.columns[1].value, "=not-derived")),
            listOf(SheetFormulaBindingWrite(sheetId, mapOf(ROW_OUTPUT to template))),
        )
        val overrideRejected = assertFailsWith<WorkbookApplicationException> { applyModelRowPatch(workbook, calculatedOverride) }
        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, overrideRejected.error)
    }

    @Test
    fun `trusted row materialization requires templates and ignores unbound calculated properties`() {
        val sheetId = "40000000-0000-0000-0000-000000000010"
        val source = rowWorkbook(sheetId)
        val sheet = source.documents.getValue(SheetId(sheetId))
        val bound = sheet.copy(
            modelId = ROW_MODEL,
            modelColumnBindings = mapOf(ROW_INPUT to sheet.tabularContent.columns[0], ROW_OUTPUT to sheet.tabularContent.columns[1]),
        )
        val workbook = source.replaceSheet(bound)

        val missingTemplate = assertFailsWith<WorkbookApplicationException> {
            materializeCalculatedRow(workbook, bound, bound.tabularContent.rows.single())
        }
        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, missingTemplate.error)

        val manualOnly = bound.copy(modelColumnBindings = mapOf(ROW_INPUT to bound.tabularContent.columns[0]))
        assertEquals(manualOnly, materializeCalculatedRow(workbook.replaceSheet(manualOnly), manualOnly, manualOnly.tabularContent.rows.single()))
    }

    @Test
    fun `template bindings written with calculated cells survive a file backed reload`() {
        val database = Files.createTempFile("sheetspace-row-bindings-", ".sqlite")
        val sheetId = "40000000-0000-0000-0000-000000000006"
        try {
            lateinit var expected: Map<String, BoundModelFormula>
            SqliteWorkbookStore(database).use { store ->
                store.saveWorkbook(rowWorkbook(sheetId))
                val application = DefaultWorkbookApplication(store)
                application.updateSheetModel(sheetId, UpdateSheetModelCommand(ROW_MODEL))
                val sheet = application.loadSheet(sheetId)
                expected = mapOf(ROW_OUTPUT to rowTemplate(sheetId, sheet.tabularContent.columns[0].value))
                store.updateWorkbook { current -> applyModelRowPatch(current, ModelRowPatchCommand(
                    listOf(ExpectedSheetRevision(sheetId, sheet.revision)),
                    listOf(SheetCellWrite(sheetId, sheet.tabularContent.rows[0].value, sheet.tabularContent.columns[1].value, instantiatedRowFormula(sheet.tabularContent.columns[0].value, sheet.tabularContent.rows[0].value))),
                    listOf(SheetFormulaBindingWrite(sheetId, expected)),
                )) }
            }
            SqliteWorkbookStore(database).use { store ->
                val reloaded = store.loadSheet(SheetId(sheetId))!!
                assertEquals(expected, reloaded.modelFormulaBindings)
                assertNull(reloaded.modelFormulaBindings!!.getValue(ROW_OUTPUT).references.single().endpoints.single()!!.propertyId)
                assertTrue(reloaded.modelColumnBindings.containsKey(ROW_OUTPUT))
            }
        } finally {
            Files.deleteIfExists(database)
            Files.deleteIfExists(database.resolveSibling("${database.fileName}-wal"))
            Files.deleteIfExists(database.resolveSibling("${database.fileName}-shm"))
        }
    }
}
