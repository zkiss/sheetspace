package com.sheetspace

import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

class WorkbookApplicationDataModelPersistenceTest {
    @Test
    fun `model state replacement validates and atomically persists a bound sheet`() {
        val fixture = dataModelFixture()
        val command = fixture.command(fixture.boundWorkbook)

        val updated = fixture.application.replaceDataModelState(command)

        assertEquals(listOf(fixture.boundSheet), updated)
        assertEquals(fixture.boundWorkbook, fixture.store.loadWorkbookBundle())
    }

    @Test
    fun `model state replacement rejects malformed aggregate payloads without mutation`() {
        val fixture = dataModelFixture()
        val valid = fixture.command(fixture.boundWorkbook).workbook
        val invalidBundles = listOf(
            valid.copy(manifest = valid.manifest.copy(version = WORKBOOK_SCHEMA_VERSION + 1)),
            valid.copy(manifest = valid.manifest.copy(sheetIds = valid.manifest.sheetIds + valid.manifest.sheetIds)),
            valid.copy(dataModels = listOf(valid.dataModels.single().copy(id = "bad"))),
            valid.copy(dataModels = listOf(valid.dataModels.single().copy(name = " "))),
            valid.copy(dataModels = listOf(valid.dataModels.single().copy(properties = valid.dataModels.single().properties.mapIndexed { index, property -> if (index == 2) property.copy(name = "Double") else property }))),
            valid.copy(dataModels = listOf(valid.dataModels.single().copy(properties = listOf(valid.dataModels.single().properties.first().copy(id = "bad"))))),
            valid.copy(dataModels = listOf(valid.dataModels.single().copy(properties = listOf(valid.dataModels.single().properties.first().copy(name = " "))))),
            valid.copy(dataModels = listOf(valid.dataModels.single().copy(properties = listOf(valid.dataModels.single().properties.first().copy(formula = "=1"))))),
            valid.copy(dataModels = listOf(valid.dataModels.single().copy(properties = listOf(valid.dataModels.single().properties[1].copy(formula = null))))),
            valid.copy(dataModels = listOf(valid.dataModels.single().copy(properties = listOf(valid.dataModels.single().properties[1].copy(formula = "not a formula"))))),
            valid.copy(dataModels = listOf(valid.dataModels.single().copy(properties = listOf(
                valid.dataModels.single().properties.first().copy(kind = "unknown"),
            )))),
            valid.copy(documents = listOf(valid.documents.single().copy(id = "bad"))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(kind = "unknown")))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(rows = listOf("bad"))))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(columns = listOf("bad"))))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(rows = valid.documents.single().content.rows + valid.documents.single().content.rows.first())))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(columns = valid.documents.single().content.columns + valid.documents.single().content.columns.first())))),
            valid.copy(documents = listOf(valid.documents.single().copy(dataModelId = "00000000-0000-0000-0000-000000000199"))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(columns = valid.documents.single().content.columns.dropLast(1))))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(cells = listOf(
                CellContentResponse("not-a-uuid", valid.documents.single().content.columns.first(), "value"),
            ))))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(cells = listOf(
                CellContentResponse(valid.documents.single().content.rows.first(), "not-a-uuid", "value"),
            ))))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(cells = listOf(
                CellContentResponse(valid.documents.single().content.rows.first(), valid.documents.single().content.columns.first(), "value"),
                CellContentResponse(valid.documents.single().content.rows.first(), valid.documents.single().content.columns.first(), "value"),
            ))))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(cells = listOf(
                CellContentResponse(valid.documents.single().content.rows.first(), valid.documents.single().content.columns[1], "=1"),
            ))))),
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(cells = listOf(
                CellContentResponse(valid.documents.single().content.rows.first(), valid.documents.single().content.columns[1], "value"),
            ))))),
            valid.copy(manifest = valid.manifest.copy(sheetIds = listOf("00000000-0000-0000-0000-000000000199"))),
        )

        invalidBundles.forEach { bundle ->
            val before = fixture.store.loadWorkbookBundle()

            val rejection = assertFailsWith<WorkbookApplicationException> {
                fixture.application.replaceDataModelState(fixture.command(bundle))
            }

            assertEquals(WorkbookApplicationError.INVALID_CELL_PATCH, rejection.error)
            assertEquals(before, fixture.store.loadWorkbookBundle())
        }
    }

    @Test
    fun `model state replacement requires every calculated cell and a nonempty formula template`() {
        val fixture = dataModelFixture()
        val valid = fixture.command(fixture.boundWorkbook).workbook
        val calculatedColumn = valid.documents.single().content.columns[1]
        val malformedBundles = listOf(
            valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(
                cells = valid.documents.single().content.cells.filterNot { it.columnId == calculatedColumn },
            )))),
            valid.copy(
                dataModels = listOf(valid.dataModels.single().copy(properties = valid.dataModels.single().properties.mapIndexed { index, property ->
                    if (index == 1) property.copy(formula = "=") else property
                })),
                documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(rows = emptyList(), cells = emptyList()))),
            ),
        )

        malformedBundles.forEach { bundle ->
            val before = fixture.store.loadWorkbookBundle()

            assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
                fixture.application.replaceDataModelState(fixture.command(bundle))
            }

            assertEquals(before, fixture.store.loadWorkbookBundle())
        }
    }

    @Test
    fun `model state replacement rejects calculated formulas with forged canonical references`() {
        val fixture = dataModelFixture()
        val valid = fixture.command(fixture.boundWorkbook).workbook
        val calculatedColumn = valid.documents.single().content.columns[1]
        val forged = valid.copy(documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(
            cells = valid.documents.single().content.cells.map { cell ->
                if (cell.columnId == calculatedColumn) cell.copy(content = "=@${valid.documents.single().content.columns[2]}[${cell.rowId}]*2") else cell
            },
        ))))
        val before = fixture.store.loadWorkbookBundle()

        assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            fixture.application.replaceDataModelState(fixture.command(forged))
        }

        assertEquals(before, fixture.store.loadWorkbookBundle())
    }

    @Test
    fun `model state replacement materializes anchored and broken calculated references`() {
        val fixture = dataModelFixture()
        val valid = fixture.command(fixture.boundWorkbook).workbook
        val document = valid.documents.single()
        val amountColumn = document.content.columns.first()
        val calculatedColumn = document.content.columns[1]
        val anchored = valid.copy(
            dataModels = listOf(valid.dataModels.single().copy(properties = valid.dataModels.single().properties.mapIndexed { index, property ->
                if (index == 1) property.copy(formula = "=@\$A[\$1]*2") else property
            })),
            documents = listOf(document.copy(content = document.content.copy(cells = document.content.cells.map { cell ->
                if (cell.columnId == calculatedColumn) cell.copy(content = "=@\$${amountColumn}[\$${document.content.rows.first()}]*2") else cell
            }))),
        )
        fixture.application.replaceDataModelState(fixture.command(anchored))
        assertEquals(anchored, WorkbookReadTransportAdapter.bundle(fixture.store.loadWorkbookBundle()))
        val broken = anchored.copy(
            dataModels = listOf(anchored.dataModels.single().copy(properties = anchored.dataModels.single().properties.mapIndexed { index, property ->
                if (index == 1) property.copy(formula = "=@Z[999]") else property
            })),
            documents = listOf(anchored.documents.single().copy(content = anchored.documents.single().content.copy(cells = anchored.documents.single().content.cells.map { cell ->
                if (cell.columnId == calculatedColumn) cell.copy(content = "=#REF!") else cell
            }))),
        )
        fixture.application.replaceDataModelState(DataModelStateCommand(
            listOf(ExpectedSheetRevision(fixture.sheet.id.value, fixture.application.loadSheet(fixture.sheet.id.value).revision)),
            broken,
        ))
        assertEquals(broken, WorkbookReadTransportAdapter.bundle(fixture.store.loadWorkbookBundle()))
    }

    @Test
    fun `model state replacement preserves broken calculated column and row targets`() {
        listOf("=@Z[1]", "=@A[999]").forEach { template ->
            val fixture = dataModelFixture()
            val valid = fixture.command(fixture.boundWorkbook).workbook
            val calculatedColumn = valid.documents.single().content.columns[1]
            val broken = valid.copy(
                dataModels = listOf(valid.dataModels.single().copy(properties = valid.dataModels.single().properties.mapIndexed { index, property ->
                    if (index == 1) property.copy(formula = template) else property
                })),
                documents = listOf(valid.documents.single().copy(content = valid.documents.single().content.copy(cells = valid.documents.single().content.cells.map { cell ->
                    if (cell.columnId == calculatedColumn) cell.copy(content = "=#REF!") else cell
                }))),
            )
            fixture.application.replaceDataModelState(fixture.command(broken))
            assertEquals(broken, WorkbookReadTransportAdapter.bundle(fixture.store.loadWorkbookBundle()))
        }
    }

    @Test
    fun `row append rejects calculated templates that bypass model-state validation`() {
        listOf("=", "not a formula").forEach { template ->
            val fixture = dataModelFixture()
            val model = fixture.boundWorkbook.dataModels.values.single().copy(properties = fixture.boundWorkbook.dataModels.values.single().properties.mapIndexed { index, property ->
                if (index == 1) CalculatedDataModelProperty(property.id, property.name, template) else property
            })
            val application = DefaultWorkbookApplication(InMemoryWorkbookStore(fixture.boundWorkbook.copy(dataModels = mapOf(model.id to model))))
            assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
                application.appendRow(fixture.boundSheet.id.value, fixture.boundSheet.revision, listOf(
                    CalculatedCellAppend(fixture.boundSheet.tabularContent.columns[1].value, "=1"),
                ))
            }
        }
    }

    @Test
    fun `model state replacement rejects stale and incomplete revision guards`() {
        val fixture = dataModelFixture()
        val command = fixture.command(fixture.boundWorkbook)
        fixture.application.writeOneCell(fixture.sheet.id.value, "A1", "newer", fixture.sheet.revision)
        val before = fixture.store.loadWorkbookBundle()

        assertFailsWith<SheetRevisionConflict> { fixture.application.replaceDataModelState(command) }
        assertEquals(before, fixture.store.loadWorkbookBundle())
        val invalid = command.copy(expectedRevisions = emptyList())
        val rejection = assertFailsWith<WorkbookApplicationException> { fixture.application.replaceDataModelState(invalid) }
        assertEquals(WorkbookApplicationError.INVALID_CELL_PATCH, rejection.error)
    }

    @Test
    fun `model replacement rejects malformed guards manifests and unrelated sheet edits`() {
        val fixture = dataModelFixture()
        val valid = fixture.command(fixture.boundWorkbook)
        listOf(
            valid.copy(expectedRevisions = listOf(ExpectedSheetRevision(fixture.sheet.id.value, -1))),
            valid.copy(expectedRevisions = listOf(ExpectedSheetRevision("bad", 0))),
            valid.copy(workbook = valid.workbook.copy(manifest = valid.workbook.manifest.copy(revision = 1))),
        ).forEach { command ->
            assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
                fixture.application.replaceDataModelState(command)
            }
        }

        val other = testDocument(TEST_SHEET_2, "Other")
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore(testWorkbookOf(fixture.sheet, other)))
        val changed = testWorkbookOf(fixture.boundSheet, other.copy(name = "Changed")).copy(dataModels = fixture.boundWorkbook.dataModels)
        assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            application.replaceDataModelState(DataModelStateCommand(
                listOf(ExpectedSheetRevision(fixture.sheet.id.value, fixture.sheet.revision)),
                WorkbookReadTransportAdapter.bundle(changed),
            ))
        }
    }

    @Test
    fun `model edits guard sheets bound before and after the transition`() {
        val fixture = dataModelFixture()
        fixture.application.replaceDataModelState(fixture.command(fixture.boundWorkbook))
        val nextModel = fixture.boundWorkbook.dataModels.getValue("00000000-0000-0000-0000-000000000101").copy(name = "Updated Metrics")
        val unchanged = DataModel("00000000-0000-0000-0000-000000000150", "Unchanged", emptyList())
        val next = fixture.boundWorkbook.copy(dataModels = fixture.boundWorkbook.dataModels + (nextModel.id to nextModel) + (unchanged.id to unchanged))
        val current = fixture.application.loadWorkbookBundle()
        fixture.application.replaceDataModelState(DataModelStateCommand(
            listOf(ExpectedSheetRevision(fixture.sheet.id.value, current.documents.getValue(fixture.sheet.id).revision)),
            WorkbookReadTransportAdapter.bundle(next),
        ))
    }

    @Test
    fun `unbinding persists when the model definition is unchanged`() {
        val fixture = dataModelFixture()
        fixture.application.replaceDataModelState(fixture.command(fixture.boundWorkbook))
        val bound = fixture.application.loadWorkbookBundle()
        val unbound = bound.copy(documents = bound.documents.mapValues { (_, sheet) -> sheet.copy(dataModelId = null) })

        val updated = fixture.application.replaceDataModelState(DataModelStateCommand(
            listOf(ExpectedSheetRevision(fixture.sheet.id.value, bound.documents.getValue(fixture.sheet.id).revision)),
            WorkbookReadTransportAdapter.bundle(unbound),
        ))

        assertEquals(null, updated.single().dataModelId)
    }

    @Test
    fun `bound row append persists supplied calculated formulas and rejects invalid calculated cells`() {
        val fixture = dataModelFixture()
        fixture.application.replaceDataModelState(fixture.command(fixture.boundWorkbook))
        val calculatedColumn = fixture.boundSheet.tabularContent.columns[1]
        val appendedRowId = "00000000-0000-0000-0000-000000000201"
        val appended = fixture.application.appendRow(
            fixture.sheet.id.value,
            fixture.sheet.revision,
            listOf(CalculatedCellAppend(calculatedColumn.value, "=@${fixture.boundSheet.tabularContent.columns.first().value}[$appendedRowId]*2")),
            appendedRowId,
        )

        assertEquals(RowId(appendedRowId), appended.rowId)
        assertEquals("=@${fixture.boundSheet.tabularContent.columns.first().value}[$appendedRowId]*2", appended.sheet.tabularContent.cellContents.getValue(CellCoordinate(appended.rowId, calculatedColumn)))
        assertEquals(appended.sheet, fixture.store.loadSheet(fixture.sheet.id))

        listOf(
            emptyList(),
            listOf(CalculatedCellAppend(calculatedColumn.value, "not a formula")),
            listOf(CalculatedCellAppend(calculatedColumn.value, "=1")),
            listOf(CalculatedCellAppend(calculatedColumn.value, "=1"), CalculatedCellAppend(calculatedColumn.value, "=2")),
        ).forEach { cells ->
            val before = fixture.store.loadWorkbookBundle()
            val rejection = assertFailsWith<WorkbookApplicationException> {
                fixture.application.appendRow(fixture.sheet.id.value, appended.sheet.revision, cells)
            }
            assertEquals(WorkbookApplicationError.INVALID_CELL_PATCH, rejection.error)
            assertEquals(before, fixture.store.loadWorkbookBundle())
        }
    }

    @Test
    fun `bound row append rejects a calculated formula with a forged canonical reference`() {
        val fixture = dataModelFixture()
        fixture.application.replaceDataModelState(fixture.command(fixture.boundWorkbook))
        val calculatedColumn = fixture.boundSheet.tabularContent.columns[1]
        val appendedRowId = "00000000-0000-0000-0000-000000000201"
        val before = fixture.store.loadWorkbookBundle()

        assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            fixture.application.appendRow(
                fixture.sheet.id.value,
                fixture.sheet.revision,
                listOf(CalculatedCellAppend(calculatedColumn.value, "=@${fixture.boundSheet.tabularContent.columns[2].value}[$appendedRowId]*2")),
                appendedRowId,
            )
        }

        assertEquals(before, fixture.store.loadWorkbookBundle())
    }

    @Test
    fun `ordinary row append remains valid without calculated contents`() {
        val fixture = dataModelFixture()

        val appended = fixture.application.appendRow(fixture.sheet.id.value, fixture.sheet.revision)

        assertEquals(fixture.sheet.tabularContent.rowCount + 1, appended.sheet.tabularContent.rowCount)
        assertEquals(appended.sheet, fixture.store.loadSheet(fixture.sheet.id))
    }

    @Test
    fun `bound sheets reject column appends without changing their persisted shape`() {
        val fixture = dataModelFixture()
        fixture.application.replaceDataModelState(fixture.command(fixture.boundWorkbook))
        val bound = assertNotNull(fixture.store.loadSheet(fixture.sheet.id))

        assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            fixture.application.appendColumn(bound.id.value, bound.revision)
        }

        assertEquals(bound, fixture.store.loadSheet(fixture.sheet.id))
        assertEquals(bound, fixture.application.loadWorkbookBundle().documents.getValue(bound.id))
    }

    @Test
    fun `row append rejects invalid and duplicate client row identities without mutation`() {
        val fixture = dataModelFixture()

        assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            fixture.application.appendRow(fixture.sheet.id.value, fixture.sheet.revision, rowId = "not-a-uuid")
        }
        assertEquals(fixture.sheet, fixture.store.loadSheet(fixture.sheet.id))

        val rowId = fixture.sheet.tabularContent.rows.first().value
        assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            fixture.application.appendRow(fixture.sheet.id.value, fixture.sheet.revision, rowId = rowId)
        }
        assertEquals(fixture.sheet, fixture.store.loadSheet(fixture.sheet.id))
    }

    @Test
    fun `bound row append remains valid when a model has only manual properties`() {
        val fixture = dataModelFixture()
        val model = fixture.boundWorkbook.dataModels.values.single()
        val manualOnlyWorkbook = fixture.boundWorkbook.copy(dataModels = mapOf(model.id to model.copy(
            properties = model.properties.map { property -> ManualDataModelProperty(property.id, property.name) },
        )))
        fixture.application.replaceDataModelState(fixture.command(manualOnlyWorkbook))

        val appended = fixture.application.appendRow(fixture.sheet.id.value, fixture.sheet.revision)

        assertEquals(fixture.sheet.tabularContent.rowCount + 1, appended.sheet.tabularContent.rowCount)
        assertEquals(appended.sheet, fixture.store.loadSheet(fixture.sheet.id))
    }

    @Test
    fun `model persistence rejects incomplete aggregate and revision guards`() {
        val fixture = dataModelFixture()
        val duplicateRevisions = fixture.command(fixture.boundWorkbook).copy(
            expectedRevisions = listOf(
                ExpectedSheetRevision(fixture.sheet.id.value, fixture.sheet.revision),
                ExpectedSheetRevision(fixture.sheet.id.value, fixture.sheet.revision),
            ),
        )
        assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            fixture.application.replaceDataModelState(duplicateRevisions)
        }
        val missingSheet = fixture.command(fixture.boundWorkbook).copy(
            expectedRevisions = listOf(ExpectedSheetRevision("00000000-0000-0000-0000-000000000199", 0)),
        )
        assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            fixture.application.replaceDataModelState(missingSheet)
        }

        val unbound = testWorkbookOf(fixture.sheet)
        assertEquals(emptyList(), fixture.application.replaceDataModelState(fixture.command(unbound).copy(expectedRevisions = emptyList())))
        val orphanedBinding = fixture.sheet.copy(dataModelId = "00000000-0000-0000-0000-000000000199")
        val orphanedApplication = DefaultWorkbookApplication(InMemoryWorkbookStore(testWorkbookOf(orphanedBinding)))
        assertApplicationError(WorkbookApplicationError.INVALID_CELL_PATCH) {
            orphanedApplication.appendRow(orphanedBinding.id.value, orphanedBinding.revision)
        }
    }

    @Test
    fun `HTTP model replacement and calculated row append persist one bound aggregate`() =
        testWorkbookApplication { application ->
            val created = client.createSheet()
            val initial = application.loadWorkbookBundle()
            val modelId = "00000000-0000-0000-0000-000000000101"
            val model = modelForDefaultColumns(modelId)
            val bound = initial.copy(
                documents = initial.documents.mapValues { (_, sheet) ->
                    sheet.copy(dataModelId = modelId, content = contentWithCalculatedTemplates(sheet.tabularContent))
                },
                dataModels = mapOf(modelId to model),
            )
            val replacement = client.put("/api/workbook/data-model-state") {
                jsonBody(testJson.encodeToString(DataModelStateRequest(
                    listOf(CellRevisionRequest(created.id, created.revision)),
                    WorkbookReadTransportAdapter.bundle(bound),
                )))
            }
            val calculatedColumn = bound.documents.getValue(SheetId(created.id)).tabularContent.columns[1]
            val appendedRowId = "00000000-0000-0000-0000-000000000201"
            val append = client.post("/api/sheets/${created.id}/rows") {
                revisionHeader(application, created.id)
                jsonBody(testJson.encodeToString(RowAppendRequest(
                    listOf(CalculatedCellAppendRequest(calculatedColumn.value, "=@${bound.documents.getValue(SheetId(created.id)).tabularContent.columns.first().value}[$appendedRowId]*2")),
                    appendedRowId,
                )))
            }
            val invalidAppend = client.post("/api/sheets/${created.id}/rows") {
                revisionHeader(application, created.id)
                jsonBody("not-json")
            }
            val columnAppend = client.post("/api/sheets/${created.id}/columns") {
                revisionHeader(application, created.id)
            }

            assertEquals(HttpStatusCode.OK, replacement.status)
            assertEquals(HttpStatusCode.OK, append.status)
            assertEquals(HttpStatusCode.BadRequest, invalidAppend.status)
            assertEquals(HttpStatusCode.BadRequest, columnAppend.status)
            assertEquals(ErrorResponse("invalid-request"), testJson.decodeFromString(invalidAppend.bodyAsText()))
            assertEquals(ErrorResponse("invalid-cell-patch"), testJson.decodeFromString(columnAppend.bodyAsText()))
            val appendResult = testJson.decodeFromString<RowAppendResponse>(append.bodyAsText())
            assertEquals(appendedRowId, appendResult.rowId)
            assertEquals("=@${bound.documents.getValue(SheetId(created.id)).tabularContent.columns.first().value}[$appendedRowId]*2", application.loadWorkbookBundle().documents.getValue(SheetId(created.id)).tabularContent.cellContents.getValue(CellCoordinate(RowId(appendResult.rowId), calculatedColumn)))
            assertEquals(bound.documents.getValue(SheetId(created.id)).tabularContent.columnCount, application.loadWorkbookBundle().documents.getValue(SheetId(created.id)).tabularContent.columnCount)
        }

    private fun dataModelFixture(): DataModelFixture {
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        val modelId = "00000000-0000-0000-0000-000000000101"
        val model = modelForDefaultColumns(modelId)
        val boundSheet = sheet.copy(
            dataModelId = modelId,
            content = contentWithCalculatedTemplates(sheet.tabularContent.updateCell("A1", "5")),
        )
        val boundWorkbook = testWorkbookOf(boundSheet).copy(dataModels = mapOf(modelId to model))
        val store = InMemoryWorkbookStore(testWorkbookOf(sheet))
        return DataModelFixture(DefaultWorkbookApplication(store), store, sheet, boundSheet, boundWorkbook)
    }

    private fun modelForDefaultColumns(modelId: String) = DataModel(
        modelId,
        "Metrics",
        listOf(
            ManualDataModelProperty("00000000-0000-0000-0000-000000000102", "Amount"),
            CalculatedDataModelProperty("00000000-0000-0000-0000-000000000103", "Double", "=@A[1]*2"),
            ManualDataModelProperty("00000000-0000-0000-0000-000000000104", "Note"),
        ) + (5..11).map { index ->
            ManualDataModelProperty("00000000-0000-0000-0000-0000000001$index", "Input $index")
        },
    )

    private fun contentWithCalculatedTemplates(content: TabularContent): TabularContent =
        content.rows.indices.fold(content) { populated, index ->
            populated.updateCell("B${index + 1}", "=@${content.columns.first().value}[${content.rows[index].value}]*2")
        }

    private data class DataModelFixture(
        val application: DefaultWorkbookApplication,
        val store: InMemoryWorkbookStore,
        val sheet: SheetDocument,
        val boundSheet: SheetDocument,
        val boundWorkbook: WorkbookState,
    ) {
        fun command(workbook: WorkbookState) = DataModelStateCommand(
            listOf(ExpectedSheetRevision(sheet.id.value, sheet.revision)),
            WorkbookReadTransportAdapter.bundle(workbook),
        )

        fun command(bundle: WorkbookBundleResponse) = DataModelStateCommand(
            listOf(ExpectedSheetRevision(sheet.id.value, sheet.revision)),
            bundle,
        )
    }

    private fun assertApplicationError(expected: WorkbookApplicationError, action: () -> Unit) {
        assertEquals(expected, assertFailsWith<WorkbookApplicationException> { action() }.error)
    }
}
