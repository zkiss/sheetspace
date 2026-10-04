package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertFailsWith

class SqliteIdEncodingTest {
    @Test
    fun `UUID encoding rejects values that are not sixteen bytes`() {
        assertFailsWith<IllegalArgumentException> { byteArrayOf(1).toUuidString() }
    }
}
