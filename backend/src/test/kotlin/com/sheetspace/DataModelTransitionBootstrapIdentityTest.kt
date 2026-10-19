package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFalse

class DataModelTransitionBootstrapIdentityTest {
    @Test
    fun `bootstrap rejects duplicate sheet row and column identities`() {
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(duplicateSheetIdentityWorkbook()))
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(duplicateRowIdentityWorkbook()))
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(duplicateColumnIdentityWorkbook()))
    }

    @Test
    fun `bootstrap rejects a document or cell coordinate with mismatched identities`() {
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(mismatchedDocumentIdentityWorkbook()))
        assertFalse(DataModelTransitionPolicy.permitsBootstrap(foreignCellCoordinateWorkbook()))
    }
}
