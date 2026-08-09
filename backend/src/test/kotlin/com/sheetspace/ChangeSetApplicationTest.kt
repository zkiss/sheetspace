package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class ChangeSetApplicationTest {
    @Test
    fun `sheet change set applies compound operations with one revision increment`() {
        val initial = workbookWithTwoSheets()
        val sheet = initial.sheetsInOrder.first()
        val coordinate = CellCoordinate(sheet.tabularContent.rows.first(), sheet.tabularContent.columns.first())
        val store = InMemoryWorkbookStore(initial)
        val application = DefaultWorkbookApplication(store)

        val result = application.applyChangeSet(
            SheetScopedChangeSet(
                clientActionId = ACTION_1,
                sheetId = sheet.id,
                expectedRevision = sheet.revision,
                operations = listOf(
                    SheetChangeOperation.Rename(" Renamed "),
                    SheetChangeOperation.SetCellContent(coordinate, "42"),
                    SheetChangeOperation.SetFrame(sheet.frame.copy(position = WorkspacePosition(10.0, 20.0))),
                ),
            ),
        )

        assertEquals(listOf(SheetRevisionExpectation(sheet.id, sheet.revision + 1)), result.sheetRevisions)
        assertEquals(listOf("rename-sheet", "set-cell-content", "set-sheet-frame"), result.operations.map { it.kind })
        val saved = store.loadSheet(sheet.id)!!
        assertEquals("Renamed", saved.name)
        assertEquals("42", saved.tabularContent.cellContents[coordinate])
        assertEquals(WorkspacePosition(10.0, 20.0), saved.frame.position)
        assertEquals(sheet.revision + 1, saved.revision)
    }

    @Test
    fun `sheet change ignores unrelated sheet revision`() {
        val initial = workbookWithTwoSheets()
        val first = initial.sheetsInOrder.first()
        val second = initial.sheetsInOrder.last()
        val store = InMemoryWorkbookStore(
            initial.replaceSheet(second.copy(revision = second.revision + 20)),
        )

        DefaultWorkbookApplication(store).applyChangeSet(
            SheetScopedChangeSet(ACTION_1, first.id, first.revision, listOf(SheetChangeOperation.Rename("Changed"))),
        )

        assertEquals("Changed", store.loadSheet(first.id)?.name)
        assertEquals(second.revision + 20, store.loadSheet(second.id)?.revision)
    }

    @Test
    fun `multi-sheet conflict reports every stale aggregate without writes`() {
        val initial = workbookWithTwoSheets()
        val first = initial.sheetsInOrder.first()
        val second = initial.sheetsInOrder.last()
        val store = InMemoryWorkbookStore(initial)
        val application = DefaultWorkbookApplication(store)
        val changeSet = MultiSheetChangeSet(
            clientActionId = ACTION_1,
            expectedManifestRevision = null,
            expectedSheetRevisions = listOf(
                SheetRevisionExpectation(first.id, first.revision - 1),
                SheetRevisionExpectation(second.id, second.revision - 1),
            ),
            operations = listOf(
                MultiSheetChangeOperation.SetSheetZIndex(first.id, 2),
                MultiSheetChangeOperation.SetSheetZIndex(second.id, 1),
            ),
        )

        val conflict = assertFailsWith<ChangeSetRevisionConflict> { application.applyChangeSet(changeSet) }

        assertEquals(listOf(first.id.value, second.id.value), conflict.conflicts.map { it.sheetId })
        assertEquals(initial, store.loadWorkbookBundle())
    }

    @Test
    fun `invalid later operation rolls back whole multi-sheet action`() {
        val initial = workbookWithTwoSheets()
        val first = initial.sheetsInOrder.first()
        val store = InMemoryWorkbookStore(initial)
        val changeSet = MultiSheetChangeSet(
            ACTION_1,
            expectedManifestRevision = initial.manifest.revision,
            expectedSheetRevisions = listOf(SheetRevisionExpectation(first.id, first.revision)),
            operations = listOf(
                MultiSheetChangeOperation.SetSheetZIndex(first.id, 9),
                MultiSheetChangeOperation.CreateSheet(ACTION_1, "Beta", FrameState(zIndex = 8)),
            ),
        )

        assertFailsWith<WorkbookApplicationException> {
            DefaultWorkbookApplication(store).applyChangeSet(changeSet)
        }
        assertEquals(initial, store.loadWorkbookBundle())
    }

    @Test
    fun `create returns backend identities and increments manifest once`() {
        val initial = workbookWithTwoSheets()
        val store = InMemoryWorkbookStore(initial)
        val result = DefaultWorkbookApplication(store).applyChangeSet(
            MultiSheetChangeSet(
                ACTION_1,
                initial.manifest.revision,
                emptyList(),
                listOf(
                    MultiSheetChangeOperation.CreateSheet(
                        ACTION_1,
                        " Created ",
                        FrameState(WorkspacePosition(3.0, 4.0), SheetFrameSize(300.0, 200.0), 3),
                    ),
                ),
            ),
        )

        val create = result.operations.single()
        assertEquals(initial.manifest.revision + 1, result.manifestRevision)
        assertEquals("Created", create.name)
        assertEquals(DEFAULT_ROW_COUNT, create.rowIds?.size)
        assertEquals(DEFAULT_COLUMN_COUNT, create.columnIds?.size)
        assertNotEquals(ACTION_1, create.sheetId)
        assertEquals(0, result.sheetRevisions.single().revision)
    }

    @Test
    fun `duplicate action returns original result and changed payload is rejected`() {
        val initial = workbookWithTwoSheets()
        val sheet = initial.sheetsInOrder.first()
        val store = InMemoryWorkbookStore(initial)
        val application = DefaultWorkbookApplication(store)
        val original = SheetScopedChangeSet(
            ACTION_1, sheet.id, sheet.revision, listOf(SheetChangeOperation.AppendRow),
        )

        val first = application.applyChangeSet(original)
        val retry = application.applyChangeSet(original)

        assertEquals(first, retry)
        assertEquals(sheet.tabularContent.rowCount + 1, store.loadSheet(sheet.id)?.tabularContent?.rowCount)
        assertFailsWith<ActionIdReuseConflict> {
            application.applyChangeSet(original.copy(operations = listOf(SheetChangeOperation.AppendColumn)))
        }
    }

    @Test
    fun `receipt fingerprint distinguishes delimited user values from multiple operations`() {
        val initial = workbookWithTwoSheets()
        val sheet = initial.sheetsInOrder.first()
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore(initial))
        application.applyChangeSet(
            SheetScopedChangeSet(
                ACTION_1,
                sheet.id,
                sheet.revision,
                listOf(SheetChangeOperation.Rename("A);Rename(name=B")),
            ),
        )

        assertFailsWith<ActionIdReuseConflict> {
            application.applyChangeSet(
                SheetScopedChangeSet(
                    ACTION_1,
                    sheet.id,
                    sheet.revision,
                    listOf(SheetChangeOperation.Rename("A"), SheetChangeOperation.Rename("B")),
                ),
            )
        }
    }

    @Test
    fun `invalid expectation set and invalid cell identity are rejected`() {
        val initial = workbookWithTwoSheets()
        val first = initial.sheetsInOrder.first()
        val second = initial.sheetsInOrder.last()
        val application = DefaultWorkbookApplication(InMemoryWorkbookStore(initial))
        assertFailsWith<WorkbookApplicationException> {
            application.applyChangeSet(
                MultiSheetChangeSet(
                    ACTION_1,
                    null,
                    listOf(SheetRevisionExpectation(first.id, first.revision)),
                    listOf(MultiSheetChangeOperation.SetSheetZIndex(second.id, 1)),
                ),
            )
        }
        assertFailsWith<WorkbookApplicationException> {
            application.applyChangeSet(
                SheetScopedChangeSet(
                    ACTION_2,
                    first.id,
                    first.revision,
                    listOf(
                        SheetChangeOperation.SetCellContent(
                            CellCoordinate(RowId.generate(), first.tabularContent.columns.first()),
                            "x",
                        ),
                    ),
                ),
            )
        }
    }
}

internal const val ACTION_1 = "90000000-0000-0000-0000-000000000001"
internal const val ACTION_2 = "90000000-0000-0000-0000-000000000002"

internal fun workbookWithTwoSheets(): WorkbookState {
    val first = SheetDocument(
        SheetId("00000000-0000-0000-0000-000000000001"),
        revision = 4,
        name = "Alpha",
        frame = FrameState(zIndex = 1),
    )
    val second = SheetDocument(
        SheetId("00000000-0000-0000-0000-000000000002"),
        revision = 7,
        name = "Beta",
        frame = FrameState(zIndex = 2),
    )
    return WorkbookState(
        WorkbookManifest(revision = 3, sheetIds = listOf(first.id, second.id)),
        mapOf(first.id to first, second.id to second),
    )
}
