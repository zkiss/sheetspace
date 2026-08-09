package com.sheetspace

import io.ktor.client.request.post
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import java.util.UUID
import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class ChangeSetContractRoutesTest {
    @Test
    fun `shared request fixture matches typed transport contract`() {
        val fixture = checkNotNull(javaClass.getResource("/change-set-contract.json")).readText()
        val request = testJson.decodeFromString<ChangeSetRequest>(fixture)
        val changeSet = WorkbookChangeSetTransportAdapter.request(request) as SheetScopedChangeSet

        assertEquals(ACTION_1, changeSet.clientActionId)
        assertEquals(TEST_SHEET_1, changeSet.sheetId.value)
        assertEquals(4, changeSet.expectedRevision)
        assertEquals(1, changeSet.operations.size)
    }

    @Test
    fun `route returns authoritative ids and duplicate submission returns original response`() =
        testWorkbookApplication { application ->
            val sheet = client.createSheet()
            val actionId = UUID.randomUUID().toString()
            val request = ChangeSetRequest(
                version = 1,
                scope = "sheet",
                clientActionId = actionId,
                sheetId = sheet.id,
                expectedRevision = ChangeSetRevisionRequest(sheet.id, sheet.revision),
                operations = listOf(ChangeSetOperationRequest(kind = "append-row")),
            )

            val first = client.post("/api/change-sets") { jsonBody(testJson.encodeToString(request)) }
            val firstBody = first.bodyAsText()
            val retry = client.post("/api/change-sets") { jsonBody(testJson.encodeToString(request)) }

            assertEquals(HttpStatusCode.OK, first.status)
            assertEquals(firstBody, retry.bodyAsText())
            val result = testJson.decodeFromString<AppliedChangeSet>(firstBody)
            assertEquals(sheet.revision + 1, result.sheetRevisions.single().revision)
            assertNotNull(UUID.fromString(result.operations.single().rowId))
            assertEquals(sheet.content.rows.size + 1, application.loadSheet(sheet.id).tabularContent.rowCount)

            val reused = client.post("/api/change-sets") {
                jsonBody(testJson.encodeToString(request.copy(
                    operations = listOf(ChangeSetOperationRequest(kind = "append-column")),
                )))
            }
            assertEquals(HttpStatusCode.Conflict, reused.status)
            assertEquals(ErrorResponse("action-id-reused"), reused.decodeBody<ErrorResponse>())
        }

    @Test
    fun `route reports all stale touched revisions without partial writes`() =
        testWorkbookApplication { application ->
            val first = client.createSheet()
            val secondResponse = client.post("/api/sheets") {
                jsonBody("""{"name":"Outputs","position":{"x":0.0,"y":0.0}}""")
            }
            assertEquals(HttpStatusCode.Created, secondResponse.status)
            val second = secondResponse.decodeBody<SheetDocumentResponse>()
            val request = ChangeSetRequest(
                version = 1,
                scope = "multi-sheet",
                clientActionId = UUID.randomUUID().toString(),
                expectedSheetRevisions = listOf(
                    ChangeSetRevisionRequest(first.id, first.revision + 1),
                    ChangeSetRevisionRequest(second.id, second.revision + 1),
                ),
                operations = listOf(
                    ChangeSetOperationRequest(kind = "set-sheet-z-index", sheetId = first.id, zIndex = 2),
                    ChangeSetOperationRequest(kind = "set-sheet-z-index", sheetId = second.id, zIndex = 1),
                ),
            )

            val response = client.post("/api/change-sets") { jsonBody(testJson.encodeToString(request)) }

            assertEquals(HttpStatusCode.Conflict, response.status)
            val conflict = response.decodeBody<RevisionConflictResponse>()
            assertEquals("revision-conflict", conflict.error)
            assertEquals(setOf(first.id, second.id), conflict.conflicts.mapNotNull { it.sheetId }.toSet())
            assertEquals(first.frame.zIndex, application.loadSheet(first.id).frame.zIndex)
            assertEquals(second.frame.zIndex, application.loadSheet(second.id).frame.zIndex)
        }

    @Test
    fun `route rejects unsupported version and malformed operation shape`() = testWorkbookApplication {
        val unsupported = client.post("/api/change-sets") {
            jsonBody(
                """{"version":2,"scope":"sheet","clientActionId":"$ACTION_1","sheetId":"$TEST_SHEET_1","expectedRevision":{"sheetId":"$TEST_SHEET_1","revision":0},"operations":[{"kind":"append-row"}]}""",
            )
        }
        val malformed = client.post("/api/change-sets") {
            jsonBody(
                """{"version":1,"scope":"sheet","clientActionId":"$ACTION_1","sheetId":"$TEST_SHEET_1","expectedRevision":{"sheetId":"$TEST_SHEET_1","revision":0},"operations":[{"kind":"append-row","name":"bad"}]}""",
            )
        }

        assertEquals(HttpStatusCode.BadRequest, unsupported.status)
        assertEquals(ErrorResponse("unsupported-change-set-version"), unsupported.decodeBody<ErrorResponse>())
        assertEquals(HttpStatusCode.BadRequest, malformed.status)
        assertEquals(ErrorResponse("invalid-change-set"), malformed.decodeBody<ErrorResponse>())
    }
}
