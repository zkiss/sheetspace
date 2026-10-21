package com.sheetspace

import io.ktor.client.request.patch
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The ordinary content-write contract carries no template bindings and owns no calculated
 * target, so a calculated cell is rejected even when the payload repeats the derived value.
 */
class CalculatedCellWriteContractTest {
    @Test
    fun `an ordinary patch carrying template bindings is rejected as an invalid request`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
            store.saveWorkbook(bound)
            val sheet = bound.sheetsInOrder.first()
            val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
            val row = sheet.tabularContent.rows.first()

            testApplication {
                application { module(DefaultWorkbookApplication(store)) }
                val response = client.patch("/api/cells") {
                    jsonBody(
                        """{"expectedRevisions":[{"sheetId":"${sheet.id.value}","revision":${sheet.revision}}],"cells":[{"sheetId":"${sheet.id.value}","rowId":"${row.value}","columnId":"${output.value}","raw":"=override"}],"modelFormulaBindings":[{"sheetId":"${sheet.id.value}","bindings":{}}]}""",
                    )
                }

                assertEquals(HttpStatusCode.BadRequest, response.status)
                assertEquals(ErrorResponse("invalid-request"), response.decodeBody())
                assertEquals(bound, store.loadWorkbookBundle())
            }
        }
    }

    @Test
    fun `an ordinary patch cannot resubmit the derived value of a calculated cell`() {
        SqliteWorkbookStore.inMemory().use { store ->
            val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
            store.saveWorkbook(bound)
            val sheet = bound.sheetsInOrder.first()
            val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)
            val row = sheet.tabularContent.rows.first()
            val derived = sheet.tabularContent.cellContents.getValue(CellCoordinate(row, output))

            testApplication {
                application { module(DefaultWorkbookApplication(store)) }
                val response = client.patch("/api/cells") {
                    jsonBody(
                        testJson.encodeToString(
                            CellPatchRequest(
                                expectedRevisions = listOf(CellRevisionRequest(sheet.id.value, sheet.revision)),
                                cells = listOf(CellWriteRequest(sheet.id.value, row.value, output.value, derived)),
                            ),
                        ),
                    )
                }

                assertEquals(HttpStatusCode.BadRequest, response.status)
                assertEquals(ErrorResponse("calculated-cell-write"), response.decodeBody())
                assertEquals(bound, store.loadWorkbookBundle())
            }
        }
    }
}
