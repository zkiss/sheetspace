package com.sheetspace

import io.ktor.client.request.put
import io.ktor.client.request.post
import io.ktor.client.request.patch
import io.ktor.client.request.header
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.nio.file.Files
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class ModelLifecycleRoutesTest {
    @Test
    fun `empty bound sheets retain templates while authoritative appended rows and frontend formulas survive reload`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
            val empty = bound.copy(documents = bound.documents.mapValues { (_, sheet) -> sheet.copy(content = TabularContent(emptyList(), sheet.tabularContent.columns, emptyMap()), presentation = SheetPresentation()) })
            val before = empty.copy(documents = empty.documents.mapValues { (_, sheet) -> sheet.copy(modelId = null, modelColumnBindings = emptyMap(), modelFormulaBindings = null) })
            store.saveWorkbook(before)
            testApplication {
                application { module(DefaultWorkbookApplication(store)) }
                assertEquals(HttpStatusCode.OK, client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, empty)) }.status)
                val id = empty.sheetsInOrder.first().id
                val inputColumn = empty.documents.getValue(id).tabularContent.columns[0]
                val outputColumn = empty.documents.getValue(id).tabularContent.columns[1]
                repeat(2) { index ->
                    val reloaded = store.loadSheet(id)!!
                    val row = client.post("/api/sheets/${id.value}/rows") { header("If-Match", reloaded.revision) }.decodeBody<RowAppendResponse>()
                    val formula = derivedFormulaRaw(empty.documents.getValue(id).modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT), store.loadWorkbookBundle(), index)
                    val request = CellPatchRequest(
                        listOf(CellRevisionRequest(id.value, row.revision)),
                        listOf(CellWriteRequest(id.value, row.rowId, inputColumn.value, "5")),
                    )
                    assertEquals(HttpStatusCode.OK, client.patch("/api/cells") { jsonBody(Json.encodeToString(request)) }.status)
                    val saved = store.loadWorkbookBundle().documents.getValue(id)
                    assertEquals(index + 1, saved.tabularContent.rowCount)
                    assertEquals(formula, saved.tabularContent.cellContents[CellCoordinate(RowId(row.rowId), outputColumn)])
                    assertEquals(empty.documents.getValue(id).modelFormulaBindings, saved.modelFormulaBindings)
                }
            }
        }
    }

    @Test
    fun `atomic lifecycle writes round trip all instances and frozen literals without backend evaluation`() {
        val database = Files.createTempFile("sheetspace-lifecycle-", ".sqlite")
        val before = lifecycleWorkbook()
        val bound = lifecycleBoundWorkbook(before)
        lateinit var frozen: WorkbookState
        try {
            SqliteWorkbookStore(database).use { store ->
                store.saveWorkbook(before)
                testApplication {
                    application { module(DefaultWorkbookApplication(store)) }
                    val response = client.put("/api/workbook/model-lifecycle") {
                        jsonBody(lifecycleBody(before, bound))
                    }
                    assertEquals(HttpStatusCode.OK, response.status)
                    val saved = response.decodeBody<WorkbookBundleResponse>().toLifecycleWorkbook()
                    assertEquals(bound.documents.mapValues { it.value.content }, saved.documents.mapValues { it.value.content })
                    assertEquals(bound.documents.values.map { it.modelFormulaBindings }, saved.documents.values.map { it.modelFormulaBindings })
                    assertNotEquals(before.documents.values.first().revision, saved.documents.values.first().revision)

                    val retry = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, bound)) }
                    assertEquals(HttpStatusCode.OK, retry.status)
                    assertEquals(saved, retry.decodeBody<WorkbookBundleResponse>().toLifecycleWorkbook())

                    val renamed = saved.copy(
                        dataModels = saved.dataModels.mapValues { (_, model) -> model.copy(name = "Renamed") },
                        documents = saved.documents.mapValues { (_, sheet) ->
                            val content = sheet.tabularContent
                            sheet.copy(content = TabularContent(content.rows, content.columns.reversed(), content.cellContents))
                        },
                    )
                    assertEquals(HttpStatusCode.OK, client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(saved, renamed)) }.status)
                    val changed = store.loadWorkbookBundle()
                    frozen = changed.copy(documents = changed.documents.mapValues { (_, sheet) ->
                        sheet.copy(modelId = null, modelColumnBindings = emptyMap(), modelFormulaBindings = null, content = sheet.tabularContent.updateCell("A1", "\u001eSheetspace:text:\"=not code\"").updateCell("A2", "\u001eSheetspace:text:\"#DIV/0!\""))
                    })
                    assertEquals(HttpStatusCode.OK, client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(changed, frozen)) }.status)
                    frozen = store.loadWorkbookBundle()
                }
            }
            SqliteWorkbookStore(database).use { store ->
                assertEquals(frozen, store.loadWorkbookBundle())
                assertEquals("\u001eSheetspace:text:\"=not code\"", store.loadWorkbookBundle().sheetsInOrder.first().tabularContent.cells["A1"])
            }
        } finally {
            Files.deleteIfExists(database)
            Files.deleteIfExists(database.resolveSibling("${database.fileName}-wal"))
            Files.deleteIfExists(database.resolveSibling("${database.fileName}-shm"))
        }
    }

    @Test
    fun `stale sheet or model snapshots and malformed writes never partially update durable state`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val before = lifecycleWorkbook()
            store.saveWorkbook(before)
            val after = lifecycleBoundWorkbook(before)
            testApplication {
                application { module(DefaultWorkbookApplication(store)) }
                val changed = store.updateWorkbook { current -> current.replaceSheet(current.sheetsInOrder.last().rename("Concurrent")) }
                val conflict = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, after)) }
                assertEquals(HttpStatusCode.Conflict, conflict.status)
                assertEquals(ErrorResponse("model-lifecycle-conflict"), conflict.decodeBody())
                assertEquals(changed, store.loadWorkbookBundle())

                val invalid = after.copy(documents = after.documents.mapValues { (_, sheet) -> sheet.copy(name = "Duplicate") })
                val rejected = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(changed, invalid)) }
                assertEquals(HttpStatusCode.BadRequest, rejected.status)
                assertEquals(ErrorResponse("invalid-model-lifecycle"), rejected.decodeBody())
                assertEquals(changed, store.loadWorkbookBundle())
                val malformed = client.put("/api/workbook/model-lifecycle") { jsonBody("{}") }
                assertEquals(HttpStatusCode.BadRequest, malformed.status)
            }
        }
    }

    @Test
    fun `template-free model binding rejects calculated models while lifecycle binding and unbinding remain atomic`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val before = lifecycleWorkbook()
            val bound = lifecycleBoundWorkbook(before)
            val sheet = before.sheetsInOrder.first()
            store.saveWorkbook(before)
            testApplication {
                application { module(DefaultWorkbookApplication(store)) }

                val rejected = client.put("/api/sheets/${sheet.id.value}/model") { jsonBody("""{"modelId":"$LIFECYCLE_MODEL"}""") }
                assertEquals(HttpStatusCode.BadRequest, rejected.status)
                assertEquals(ErrorResponse("invalid-model-lifecycle"), rejected.decodeBody())
                assertEquals(before, store.loadWorkbookBundle())

                val customAttachment = client.put("/api/sheets/${sheet.id.value}/model") {
                    jsonBody("""{"modelId":"$LIFECYCLE_MODEL","modelColumnBindings":{"$LIFECYCLE_INPUT":"${sheet.tabularContent.columns[2].value}","$LIFECYCLE_OUTPUT":"${sheet.tabularContent.columns[1].value}"}}""")
                }
                assertEquals(HttpStatusCode.BadRequest, customAttachment.status)
                assertEquals(ErrorResponse("invalid-model-lifecycle"), customAttachment.decodeBody())
                assertEquals(before, store.loadWorkbookBundle())

                val partialAttachment = client.put("/api/sheets/${sheet.id.value}/model") {
                    jsonBody("""{"modelId":"$LIFECYCLE_MODEL","modelColumnBindings":{"$LIFECYCLE_INPUT":"${sheet.tabularContent.columns[2].value}"}}""")
                }
                assertEquals(HttpStatusCode.BadRequest, partialAttachment.status)
                assertEquals(ErrorResponse("invalid-model-lifecycle"), partialAttachment.decodeBody())
                assertEquals(before, store.loadWorkbookBundle())

                assertEquals(HttpStatusCode.OK, client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, bound)) }.status)
                val saved = store.loadWorkbookBundle()
                val savedSheet = saved.documents.getValue(sheet.id)
                val idempotent = client.put("/api/sheets/${sheet.id.value}/model") {
                    jsonBody("""{"modelId":"$LIFECYCLE_MODEL","modelColumnBindings":{"$LIFECYCLE_INPUT":"${savedSheet.tabularContent.columns[0].value}","$LIFECYCLE_OUTPUT":"${savedSheet.tabularContent.columns[1].value}"}}""")
                }
                assertEquals(HttpStatusCode.OK, idempotent.status)
                assertEquals(saved, store.loadWorkbookBundle())

                val customRebinding = client.put("/api/sheets/${sheet.id.value}/model") {
                    jsonBody("""{"modelId":"$LIFECYCLE_MODEL","modelColumnBindings":{"$LIFECYCLE_INPUT":"${savedSheet.tabularContent.columns[1].value}","$LIFECYCLE_OUTPUT":"${savedSheet.tabularContent.columns[0].value}"}}""")
                }
                assertEquals(HttpStatusCode.BadRequest, customRebinding.status)
                assertEquals(ErrorResponse("invalid-model-lifecycle"), customRebinding.decodeBody())
                assertEquals(saved, store.loadWorkbookBundle())

                val clearedCalculatedBinding = client.put("/api/sheets/${sheet.id.value}/model") {
                    jsonBody("""{"modelId":"$LIFECYCLE_MODEL","modelColumnBindings":{"$LIFECYCLE_INPUT":"${savedSheet.tabularContent.columns[1].value}"}}""")
                }
                assertEquals(HttpStatusCode.BadRequest, clearedCalculatedBinding.status)
                assertEquals(ErrorResponse("invalid-model-lifecycle"), clearedCalculatedBinding.decodeBody())
                assertEquals(saved, store.loadWorkbookBundle())

                val emptiedBindings = client.put("/api/sheets/${sheet.id.value}/model") {
                    jsonBody("""{"modelId":"$LIFECYCLE_MODEL","modelColumnBindings":{}}""")
                }
                assertEquals(HttpStatusCode.BadRequest, emptiedBindings.status)
                assertEquals(ErrorResponse("invalid-model-lifecycle"), emptiedBindings.decodeBody())
                assertEquals(saved, store.loadWorkbookBundle())

                assertEquals(HttpStatusCode.OK, client.put("/api/sheets/${sheet.id.value}/model") { jsonBody("""{"modelId":null}""") }.status)
                val unbound = store.loadWorkbookBundle().documents.getValue(sheet.id)
                assertEquals(null, unbound.modelId)
                assertEquals(null, unbound.modelFormulaBindings)
                assertEquals(savedSheet.tabularContent, unbound.tabularContent)
                assertEquals(savedSheet.presentation, unbound.presentation)

                val zeroRow = lifecycleWorkbook().let { workbook ->
                    val zeroSheet = workbook.sheetsInOrder.first().let { current ->
                        current.copy(content = TabularContent(emptyList(), current.tabularContent.columns, emptyMap()))
                    }
                    workbook.replaceSheet(zeroSheet)
                }
                store.saveWorkbook(zeroRow)
                val zeroRowSheet = zeroRow.sheetsInOrder.first()
                val zeroRowRejected = client.put("/api/sheets/${zeroRowSheet.id.value}/model") { jsonBody("""{"modelId":"$LIFECYCLE_MODEL"}""") }
                assertEquals(HttpStatusCode.BadRequest, zeroRowRejected.status)
                assertEquals(ErrorResponse("invalid-model-lifecycle"), zeroRowRejected.decodeBody())
                assertEquals(zeroRow, store.loadWorkbookBundle())
            }
        }
    }

    @Test
    fun `template-free declaration edits reject calculated formula changes while lifecycle reconciles SQLite sheets`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val before = lifecycleBoundWorkbook(lifecycleWorkbook())
            val original = before.dataModels.getValue(LIFECYCLE_MODEL)
            val changedModel = original.copy(columns = listOf(original.columns[0], (original.columns[1] as CalculatedModelColumn).copy(formula = "=@A[1]*3")))
            val reconciled = formulaChangedWorkbook(before, changedModel)
            store.saveWorkbook(before)
            testApplication {
                application { module(DefaultWorkbookApplication(store)) }

                val rejected = client.put("/api/data-models/$LIFECYCLE_MODEL") {
                    jsonBody("""{"name":"Invoice","columns":[{"id":"$LIFECYCLE_INPUT","name":"Input","kind":"manual","type":"float"},{"id":"$LIFECYCLE_OUTPUT","name":"Output","kind":"calculated","type":"float","formula":"=@A[1]*3"}]}""")
                }
                assertEquals(HttpStatusCode.BadRequest, rejected.status)
                assertEquals(ErrorResponse("invalid-model-lifecycle"), rejected.decodeBody())
                assertEquals(before, store.loadWorkbookBundle())

                val updated = client.put("/api/workbook/model-lifecycle") { jsonBody(lifecycleBody(before, reconciled)) }
                assertEquals(HttpStatusCode.OK, updated.status)
                val saved = store.loadWorkbookBundle()
                assertEquals(changedModel, saved.dataModels.getValue(LIFECYCLE_MODEL))
                saved.sheetsInOrder.forEach { sheet ->
                    assertEquals("=@A[1]*3", StoredFormulaCodec.decode(sheet.modelFormulaBindings!!.getValue(LIFECYCLE_OUTPUT).content).text)
                    assertEquals(
                        sheet.tabularContent.rows.map { row -> "=@${sheet.modelColumnBindings.getValue(LIFECYCLE_INPUT).value}[${row.value}]*3" },
                        sheet.tabularContent.rows.map { row -> sheet.tabularContent.cellContents.getValue(CellCoordinate(row, sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT))) },
                    )
                }
            }
        }
    }

    @Test
    fun `SQLite rejects template removal and stale derived calculated contents atomically`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
            val sheet = bound.sheetsInOrder.first()
            store.saveWorkbook(bound)

            assertEquals(
                WorkbookApplicationError.CALCULATED_CELL_WRITE,
                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook { current -> current.replaceSheet(sheet.copy(modelFormulaBindings = null)) }
                }.error,
            )
            assertEquals(bound, store.loadWorkbookBundle())

            val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
            val coordinate = CellCoordinate(sheet.tabularContent.rows.first(), output)
            assertEquals(
                WorkbookApplicationError.CALCULATED_CELL_WRITE,
                assertFailsWith<WorkbookApplicationException> {
                    store.updateWorkbook { current ->
                        current.replaceSheet(
                            sheet.copy(content = sheet.tabularContent.updateCell(sheet.tabularContent.addressOf(coordinate)!!, "=stale")),
                        )
                    }
                }.error,
            )
            assertEquals(bound, store.loadWorkbookBundle())
            assertEquals(sheet.tabularContent.cellContents[coordinate], store.loadWorkbookBundle().documents.getValue(sheet.id).tabularContent.cellContents[coordinate])
        }
    }
}

internal const val LIFECYCLE_MODEL = "30000000-0000-0000-0000-000000000001"
internal const val LIFECYCLE_INPUT = "31000000-0000-0000-0000-000000000001"
internal const val LIFECYCLE_OUTPUT = "31000000-0000-0000-0000-000000000002"

internal fun lifecycleWorkbook(): WorkbookState {
    val model = DataModel(LIFECYCLE_MODEL, "Invoice", listOf(ManualModelColumn(LIFECYCLE_INPUT, "Input", ModelColumnType.FLOAT), CalculatedModelColumn(LIFECYCLE_OUTPUT, "Output", ModelColumnType.FLOAT, "=@A[1]*2")))
    val first = SheetDocument(id = SheetId.generate(), name = "One", content = TabularContent(rowCount = 2, columnCount = 3, cells = mapOf("A1" to "3")))
    val second = SheetDocument(id = SheetId.generate(), name = "Two", content = TabularContent(rowCount = 2, columnCount = 1, cells = mapOf("A1" to "7")))
    return emptyWorkbookState().addSheet(first).addSheet(second).copy(dataModels = mapOf(model.id to model))
}

internal fun lifecycleBoundWorkbook(before: WorkbookState): WorkbookState = before.copy(documents = before.documents.mapValues { (_, sheet) ->
    val content = sheet.tabularContent
    val columns = (content.columns + ColumnId.generate()).take(2)
    val template = lifecycleTemplate(sheet, columns[0], "=@A[1]*2")
    sheet.copy(
        modelId = LIFECYCLE_MODEL,
        modelColumnBindings = mapOf(LIFECYCLE_INPUT to columns[0], LIFECYCLE_OUTPUT to columns[1]),
        modelFormulaBindings = mapOf(LIFECYCLE_OUTPUT to template),
        content = TabularContent(content.rows, columns, content.cellContents)
            .updateCell("B1", instantiateStoredModelFormula(template.content, 0) { content.rows.map { it.value } })
            .updateCell("B2", instantiateStoredModelFormula(template.content, 1) { content.rows.map { it.value } }),
        presentation = SheetPresentation(rowHeights = mapOf(content.rows[0].value to 32.0), columnWidths = mapOf(columns[0].value to 100.0)),
    )
})

internal fun lifecycleTemplate(sheet: SheetDocument, column: ColumnId, formula: String, anchored: Boolean = false): BoundModelFormula {
    val end = if (anchored) 7 else 6
    return BoundModelFormula(StoredFormulaCodec.encode(StoredFormula(formula, listOf(FormulaOccurrence(
        "o", FormulaSpan(1, end), "s", listOf(FormulaEndpoint("e", "c", "r", false, anchored)),
        listOf(
            FormulaSlot("s", "sheet", JsonPrimitive(sheet.name), "retained", listOf(sheet.id.value)),
            FormulaSlot("c", "column", JsonPrimitive(0), "retained", listOf(column.value)),
            FormulaSlot("r", "row", JsonPrimitive(1), "retained", listOfNotNull(sheet.tabularContent.rows.firstOrNull()?.value)),
        ), listOf(FormulaOrigin(1, 2, null), FormulaOrigin(2, 3, "c"),
            FormulaOrigin(3, if (anchored) 5 else 4, null), FormulaOrigin(if (anchored) 5 else 4, end - 1, "r"), FormulaOrigin(end - 1, end, null)),
    )))))
}

internal fun lifecycleBody(before: WorkbookState, after: WorkbookState): String = Json.encodeToString(ModelLifecycleRequest(WorkbookReadTransportAdapter.bundle(before), WorkbookReadTransportAdapter.bundle(after)))
