package com.sheetspace

import java.nio.file.Files
import java.util.Collections
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteChangeSetTest {
    @Test
    fun `multi-sheet change is atomic and increments each touched sheet once`() = withSqliteStore { store ->
        val initial = workbookWithTwoSheets()
        store.saveWorkbook(initial)
        val first = initial.sheetsInOrder.first()
        val second = initial.sheetsInOrder.last()

        val result = DefaultWorkbookApplication(store).applyChangeSet(
            MultiSheetChangeSet(
                ACTION_1,
                null,
                listOf(
                    SheetRevisionExpectation(first.id, first.revision),
                    SheetRevisionExpectation(second.id, second.revision),
                ),
                listOf(
                    MultiSheetChangeOperation.SetSheetZIndex(first.id, 2),
                    MultiSheetChangeOperation.SetSheetZIndex(second.id, 1),
                ),
            ),
        )

        assertEquals(listOf(first.revision + 1, second.revision + 1), result.sheetRevisions.map { it.revision })
        assertEquals(2, store.loadSheet(first.id)?.frame?.zIndex)
        assertEquals(1, store.loadSheet(second.id)?.frame?.zIndex)
        assertEquals(initial.manifest.revision, store.loadManifest().revision)
    }

    @Test
    fun `successful receipt survives later changes and rejects reused action id`() = withSqliteStore { store ->
        val initial = workbookWithTwoSheets()
        store.saveWorkbook(initial)
        val sheet = initial.sheetsInOrder.first()
        val application = DefaultWorkbookApplication(store)
        val action = SheetScopedChangeSet(ACTION_1, sheet.id, sheet.revision, listOf(SheetChangeOperation.AppendRow))

        val first = application.applyChangeSet(action)
        application.applyChangeSet(
            SheetScopedChangeSet(ACTION_2, sheet.id, sheet.revision + 1, listOf(SheetChangeOperation.AppendColumn)),
        )

        assertEquals(first, application.applyChangeSet(action))
        assertEquals(sheet.tabularContent.rowCount + 1, store.loadSheet(sheet.id)?.tabularContent?.rowCount)
        assertEquals(sheet.tabularContent.columnCount + 1, store.loadSheet(sheet.id)?.tabularContent?.columnCount)
        assertFailsWith<ActionIdReuseConflict> {
            application.applyChangeSet(action.copy(operations = listOf(SheetChangeOperation.Rename("Other"))))
        }
    }

    @Test
    fun `invalid operation rolls back earlier operations and stores no receipt`() = withSqliteStore { store ->
        val initial = workbookWithTwoSheets()
        store.saveWorkbook(initial)
        val first = initial.sheetsInOrder.first()
        val application = DefaultWorkbookApplication(store)
        val invalid = MultiSheetChangeSet(
            ACTION_1,
            initial.manifest.revision,
            listOf(SheetRevisionExpectation(first.id, first.revision)),
            listOf(
                MultiSheetChangeOperation.SetSheetZIndex(first.id, 9),
                MultiSheetChangeOperation.CreateSheet(ACTION_1, "Beta", FrameState(zIndex = 8)),
            ),
        )

        assertFailsWith<WorkbookApplicationException> { application.applyChangeSet(invalid) }
        assertEquals(initial, store.loadWorkbookBundle())

        val corrected = invalid.copy(
            operations = listOf(
                MultiSheetChangeOperation.SetSheetZIndex(first.id, 9),
                MultiSheetChangeOperation.CreateSheet(ACTION_1, "Gamma", FrameState(zIndex = 8)),
            ),
        )
        application.applyChangeSet(corrected)
        assertEquals(9, store.loadSheet(first.id)?.frame?.zIndex)
    }

    @Test
    fun `receipt survives store restart`() {
        val path = Files.createTempFile("sheetspace-change-set-", ".db")
        Files.deleteIfExists(path)
        try {
            val initial = workbookWithTwoSheets()
            val sheet = initial.sheetsInOrder.first()
            val action = SheetScopedChangeSet(
                ACTION_1,
                sheet.id,
                sheet.revision,
                listOf(SheetChangeOperation.AppendRow),
            )
            val first = SqliteWorkbookStore(path).use { store ->
                store.saveWorkbook(initial)
                DefaultWorkbookApplication(store).applyChangeSet(action)
            }

            val retry = SqliteWorkbookStore(path).use { store ->
                DefaultWorkbookApplication(store).applyChangeSet(action)
            }

            assertEquals(first, retry)
        } finally {
            Files.deleteIfExists(path)
        }
    }

    @Test
    fun `concurrent duplicate submission across stores applies once`() {
        val path = Files.createTempFile("sheetspace-concurrent-action-", ".db")
        Files.deleteIfExists(path)
        try {
            val initial = workbookWithTwoSheets()
            val sheet = initial.sheetsInOrder.first()
            val firstStore = SqliteWorkbookStore(path)
            val secondStore = SqliteWorkbookStore(path)
            firstStore.saveWorkbook(initial)
            val action = SheetScopedChangeSet(
                ACTION_1,
                sheet.id,
                sheet.revision,
                listOf(SheetChangeOperation.AppendRow),
            )
            val gate = CountDownLatch(1)
            val results = Collections.synchronizedList(mutableListOf<AppliedChangeSet>())
            val workers = listOf(firstStore, secondStore).map { store ->
                thread {
                    gate.await()
                    results += DefaultWorkbookApplication(store).applyChangeSet(action)
                }
            }

            gate.countDown()
            workers.forEach { it.join() }

            assertEquals(2, results.size)
            assertEquals(results.first(), results.last())
            assertEquals(sheet.tabularContent.rowCount + 1, firstStore.loadSheet(sheet.id)?.tabularContent?.rowCount)
            firstStore.close()
            secondStore.close()
        } finally {
            Files.deleteIfExists(path)
        }
    }
}
