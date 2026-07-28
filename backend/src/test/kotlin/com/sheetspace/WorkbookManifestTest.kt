package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WorkbookManifestTest {
    @Test
    fun `manifest preserves ordered membership through add and remove`() {
        val first = SheetId("first")
        val second = SheetId("second")

        val manifest = WorkbookManifest()
            .append(first)
            .append(second)
            .remove(first)

        assertEquals(listOf(second), manifest.sheetIds)
        assertEquals(3, manifest.revision)
    }

    @Test
    fun `manifest rejects duplicate membership`() {
        val id = SheetId("duplicate")

        assertFailsWith<IllegalArgumentException> {
            WorkbookManifest(sheetIds = listOf(id, id))
        }
        assertFailsWith<IllegalArgumentException> {
            WorkbookManifest(sheetIds = listOf(id)).append(id)
        }
    }

    @Test
    fun `manifest rejects removal of absent membership without changing revision`() {
        val manifest = WorkbookManifest(sheetIds = listOf(SheetId("present")))

        assertFailsWith<IllegalArgumentException> {
            manifest.remove(SheetId("absent"))
        }
        assertEquals(0, manifest.revision)
    }

    @Test
    fun `workbook requires documents to match manifest membership`() {
        val sheet = SheetDocument(SheetId("sheet"), name = "Inputs")

        assertFailsWith<IllegalArgumentException> {
            WorkbookState(documents = mapOf(sheet.id to sheet))
        }
    }
}
