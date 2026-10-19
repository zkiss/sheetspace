package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SingletonUpdateAuthorityTest {
    @Test
    fun `singleton update authority is limited to its existing target`() {
        val thirdId = "00000000-0000-0000-0000-000000000003"
        val fourthId = "00000000-0000-0000-0000-000000000004"
        val first = testDocument(TEST_SHEET_1, "Inputs")
        val second = testDocument(TEST_SHEET_2, "Outputs")
        val before = testWorkbookOf(first, second)

        assertFalse(DataModelTransitionPolicy.isLiveCreate(before, before))
        assertFalse(
            DataModelTransitionPolicy.isLiveCreate(
                before,
                before.addSheet(testDocument(thirdId, "Third")).addSheet(testDocument(fourthId, "Fourth")),
            ),
        )
        assertTrue(DataModelTransitionPolicy.isSingletonUpdateOf(before, before, first.id))
        assertTrue(DataModelTransitionPolicy.isSingletonUpdateOf(before, before.replaceSheet(first.rename("Renamed")), first.id))
        assertFalse(DataModelTransitionPolicy.isSingletonUpdateOf(before, before.removeSheet(first.id), first.id))
        assertFalse(DataModelTransitionPolicy.isSingletonUpdateOf(before, before.replaceSheet(second.rename("Renamed")), first.id))
        assertFalse(DataModelTransitionPolicy.isSingletonUpdateOf(before, before.addSheet(testDocument(thirdId, "New")), first.id))
        assertFalse(DataModelTransitionPolicy.isSingletonUpdateOf(
            before,
            before.copy(manifest = before.manifest.copy(sheetIds = before.manifest.sheetIds.reversed())),
            first.id,
        ))
        assertFalse(DataModelTransitionPolicy.isSingletonUpdateOf(before, before, SheetId(thirdId)))
    }
}
