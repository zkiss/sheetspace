package com.sheetspace

import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AtomicAdmissionRoutesTest {
    @Test
    fun `HTTP serializes full atomic result and receipt retry even after target deletion`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        testApplication {
            application { module(scenario.app) }
            val payload = Json.encodeToString(scenario.request)
            suspend fun submit() = client.post("/api/sheets/${scenario.target.id.value}/records") {
                header("If-Match", scenario.target.revision)
                jsonBody(payload)
            }
            val response = submit()
            assertEquals(HttpStatusCode.OK, response.status)
            val result = response.decodeBody<RecordAdmissionResponse>()
            assertFalse(result.alreadyCommitted)
            assertEquals(scenario.row.value, result.rowId)
            assertEquals(store.loadWorkbookBundle(), result.workbook.toLifecycleWorkbook())
            assertEquals(3, result.workbook.documents.size)
            assertEquals(result.copy(alreadyCommitted = true), submit().decodeBody<RecordAdmissionResponse>())
            scenario.app.deleteSheet(scenario.target.id.value, store.loadSheet(scenario.target.id)!!.revision)
            val retry = submit().decodeBody<RecordAdmissionResponse>()
            assertTrue(retry.alreadyCommitted)
            assertEquals(store.loadWorkbookBundle(), retry.workbook.toLifecycleWorkbook())
            assertEquals(2, retry.workbook.documents.size)
        }
    }

    @Test
    fun `HTTP distinguishes cross-sheet revision workbook metadata and missing dependency conflicts`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        testApplication {
            application { module(scenario.app) }
            suspend fun submit(request: RecordAdmissionRequest = scenario.request) = client.post("/api/sheets/${scenario.target.id.value}/records") {
                header("If-Match", scenario.target.revision)
                jsonBody(Json.encodeToString(request))
            }
            val other = scenario.other
            scenario.app.writeOneCell(other.id.value, "A1", "9", other.revision)
            val stale = submit()
            assertEquals(HttpStatusCode.Conflict, stale.status)
            assertEquals(ErrorResponse("sheet-revision-conflict", other.id.value, other.revision, other.revision + 1), stale.decodeBody())
            val guard = WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle())
            val model = scenario.app.loadWorkbookBundle().dataModels.getValue(LIFECYCLE_MODEL)
            scenario.app.saveDataModel(model.copy(name = "Changed"))
            val conflict = submit(scenario.request.copy(before = guard))
            assertEquals(HttpStatusCode.Conflict, conflict.status)
            assertEquals(ErrorResponse("model-lifecycle-conflict", scope = "workbook"), conflict.decodeBody())
            val currentGuard = WorkbookReadTransportAdapter.bundle(store.loadWorkbookBundle())
            scenario.app.deleteSheet(scenario.untouched.id.value, scenario.untouched.revision)
            val missing = submit(scenario.request.copy(before = currentGuard))
            assertEquals(HttpStatusCode.NotFound, missing.status)
            assertEquals(ErrorResponse("sheet-not-found", sheetId = scenario.untouched.id.value), missing.decodeBody())
            assertEquals(0, admissionReceipts(store))
        }
    }

    @Test
    fun `HTTP rejects missing guards malformed orders and manual overrides without a receipt`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        testApplication {
            application { module(scenario.app) }
            val malformed = listOf(
                """{"rowId":"${scenario.row.value}","values":{}}""",
                Json.encodeToString(scenario.request.copy(rowOrders = listOf(RecordRowOrder("bad", emptyList())))),
                Json.encodeToString(scenario.request.copy(values = mapOf(LIFECYCLE_OUTPUT to "3"))),
            )
            malformed.forEach { body ->
                val response = client.post("/api/sheets/${scenario.target.id.value}/records") {
                    header("If-Match", scenario.target.revision)
                    jsonBody(body)
                }
                assertEquals(HttpStatusCode.BadRequest, response.status)
                assertEquals(scenario.before, store.loadWorkbookBundle())
                assertEquals(0, admissionReceipts(store))
            }
        }
    }
}
