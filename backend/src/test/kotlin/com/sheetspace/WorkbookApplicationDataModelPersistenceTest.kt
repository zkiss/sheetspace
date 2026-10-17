package com.sheetspace

import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

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
    fun `bound row append persists supplied calculated formulas and rejects invalid calculated cells`() {
        val fixture = dataModelFixture()
        fixture.application.replaceDataModelState(fixture.command(fixture.boundWorkbook))
        val calculatedColumn = fixture.boundSheet.tabularContent.columns[1]
        val appended = fixture.application.appendRow(
            fixture.sheet.id.value,
            fixture.sheet.revision,
            listOf(CalculatedCellAppend(calculatedColumn.value, "=@A[3]*2")),
        )

        assertEquals("=@A[3]*2", appended.sheet.tabularContent.cellContents.getValue(CellCoordinate(appended.rowId, calculatedColumn)))
        assertEquals(appended.sheet, fixture.store.loadSheet(fixture.sheet.id))

        listOf(
            emptyList(),
            listOf(CalculatedCellAppend(calculatedColumn.value, "not a formula")),
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
        assertApplicationError(WorkbookApplicationError.SHEET_NOT_FOUND) {
            fixture.application.replaceDataModelState(missingSheet)
        }

        val unbound = testWorkbookOf(fixture.sheet)
        assertEquals(listOf(fixture.sheet), fixture.application.replaceDataModelState(fixture.command(unbound)))
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
                documents = initial.documents.mapValues { (_, sheet) -> sheet.copy(dataModelId = modelId) },
                dataModels = mapOf(modelId to model),
            )
            val replacement = client.put("/api/workbook/data-model-state") {
                jsonBody(testJson.encodeToString(DataModelStateRequest(
                    listOf(CellRevisionRequest(created.id, created.revision)),
                    WorkbookReadTransportAdapter.bundle(bound),
                )))
            }
            val calculatedColumn = bound.documents.getValue(SheetId(created.id)).tabularContent.columns[1]
            val append = client.post("/api/sheets/${created.id}/rows") {
                revisionHeader(application, created.id)
                jsonBody(testJson.encodeToString(RowAppendRequest(listOf(CalculatedCellAppendRequest(calculatedColumn.value, "=@A[3]*2")))))
            }
            val invalidAppend = client.post("/api/sheets/${created.id}/rows") {
                revisionHeader(application, created.id)
                jsonBody("not-json")
            }

            assertEquals(HttpStatusCode.OK, replacement.status)
            assertEquals(HttpStatusCode.OK, append.status)
            assertEquals(HttpStatusCode.BadRequest, invalidAppend.status)
            assertEquals(ErrorResponse("invalid-request"), testJson.decodeFromString(invalidAppend.bodyAsText()))
            val appendResult = testJson.decodeFromString<RowAppendResponse>(append.bodyAsText())
            assertEquals("=@A[3]*2", application.loadSheet(created.id).tabularContent.cellContents.getValue(CellCoordinate(RowId(appendResult.rowId), calculatedColumn)))
        }

    private fun dataModelFixture(): DataModelFixture {
        val sheet = testDocument(TEST_SHEET_1, "Inputs")
        val modelId = "00000000-0000-0000-0000-000000000101"
        val model = modelForDefaultColumns(modelId)
        val boundSheet = sheet.copy(
            dataModelId = modelId,
            content = sheet.tabularContent.updateCell("A1", "5").updateCell("B1", "=@A[1]*2"),
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
