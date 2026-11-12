package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class RecordAdmissionNormalizationTest {
    @Test
    fun `request preparation rejects malformed identities duplicate orders and negative revisions`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val guard = scenario.request.before
        assertFailsWith<WorkbookApplicationException> { recordIdentity("bad") }
        assertFailsWith<WorkbookApplicationException> { prepareRecordAdmission(-1, scenario.request.values, guard, emptyList()) }
        val order = scenario.request.rowOrders.first()
        assertFailsWith<WorkbookApplicationException> { prepareRecordAdmission(0, scenario.request.values, guard, listOf(order, order)) }
        val id = scenario.target.id.value
        assertEquals(id, recordIdentity(id.uppercase()))
        assertFailsWith<WorkbookApplicationException> {
            scenario.app.admitRecord("invalid", 0, scenario.row.value, scenario.request.values, guard)
        }
    }

    @Test
    fun `canonical identities and unordered bundle collections retry the same receipt without changing formulas or values`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val request = scenario.request
        val committed = scenario.admit()
        val alias = request.copy(
            rowId = request.rowId.uppercase(),
            before = uppercaseGuardIdentifiers(request.before).let { before -> before.copy(documents = before.documents.reversed().map {
                it.copy(content = it.content.copy(cells = it.content.cells.reversed()))
            }, dataModels = before.dataModels.reversed()) },
            values = request.values.mapKeys { it.key.uppercase() },
            rowOrders = request.rowOrders.reversed().map { it.copy(sheetId = it.sheetId.uppercase(), order = it.order.map(String::uppercase)) },
        )
        val retried = scenario.app.admitRecord(scenario.target.id.value.uppercase(), scenario.target.revision, alias.rowId, alias.values, alias.before, alias.rowOrders)
        assertTrue(retried.alreadyCommitted)
        assertEquals(committed.copy(alreadyCommitted = true), retried)
        assertEquals(1, admissionReceipts(store))
    }

    @Test
    fun `fingerprinting ignores map insertion order but preserves value text and meaningful sequence ordering`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val first = "abcdefab-cdef-4abc-8def-abcdefabcdef"
        val second = "bbcdefab-cdef-4abc-8def-abcdefabcdef"
        val before = scenario.request.before
        val values = linkedMapOf(first to "a:1b", second to "2:c")
        fun fingerprint(values: Map<String, String> = linkedMapOf(first to "a:1b", second to "2:c"), guard: WorkbookBundleResponse = before) =
            prepareRecordAdmission(0, values, guard, emptyList()).fingerprint
        assertEquals(fingerprint(values), fingerprint(values.entries.reversed().associate { it.toPair() }))
        assertEquals(fingerprint(values), fingerprint(values.mapKeys { it.key.uppercase() }))
        assertNotEquals(fingerprint(), fingerprint(mapOf(first to "a:1", second to "b2:c")))
        assertNotEquals(fingerprint(), fingerprint(guard = before.copy(manifest = before.manifest.copy(sheetIds = before.manifest.sheetIds.reversed()))))
        assertNotEquals(fingerprint(), fingerprint(guard = before.copy(documents = before.documents.map { it.copy(content = it.content.copy(rows = it.content.rows.reversed())) })))
        val model = before.dataModels.single()
        assertNotEquals(fingerprint(), fingerprint(guard = before.copy(dataModels = listOf(model.copy(columns = model.columns.reversed())))))
        assertFailsWith<WorkbookApplicationException> { fingerprint(values + (first.uppercase() to "duplicate")) }
    }

    @Test
    fun `presentation identities are normalized without treating format values or names as identities`() = withSqliteStore { store ->
        val scenario = AtomicAdmissionScenario(store)
        val before = scenario.request.before
        val sheet = before.documents.first()
        val row = sheet.content.rows.first()
        val column = sheet.content.columns.first()
        val formatted = sheet.copy(
            name = "not an identity",
            columnNames = mapOf(column to "Text"),
            presentation = sheet.presentation.copy(formatOverrides = SheetFormatOverrides(
                rows = mapOf(row to CellFormat(fontWeight = "bold")),
                columns = mapOf(column to CellFormat(fontWeight = "bold")),
                cells = mapOf("$row\u0000$column" to CellFormat(fontWeight = "bold")),
            )),
        )
        val guard = before.copy(documents = listOf(formatted) + before.documents.drop(1))
        val expected = prepareRecordAdmission(0, scenario.request.values, guard, emptyList())
        assertEquals(expected, prepareRecordAdmission(0, scenario.request.values, uppercaseGuardIdentifiers(guard), emptyList()))
        val duplicateKeys = formatted.copy(columnNames = mapOf(column to "One", column.uppercase() to "Two"))
        assertFailsWith<WorkbookApplicationException> {
            prepareRecordAdmission(0, scenario.request.values, before.copy(documents = listOf(duplicateKeys) + before.documents.drop(1)), emptyList())
        }
        val badCoordinate = formatted.copy(presentation = formatted.presentation.copy(formatOverrides = SheetFormatOverrides(cells = mapOf("broken" to CellFormat(fontWeight = "bold")))))
        assertFailsWith<WorkbookApplicationException> {
            prepareRecordAdmission(0, scenario.request.values, before.copy(documents = listOf(badCoordinate) + before.documents.drop(1)), emptyList())
        }
    }
}

private fun <T> Map<String, T>.uppercaseKeys(): Map<String, T> = mapKeys { it.key.uppercase() }

private fun uppercaseGuardIdentifiers(before: WorkbookBundleResponse): WorkbookBundleResponse = before.copy(
    manifest = before.manifest.copy(sheetIds = before.manifest.sheetIds.map(String::uppercase)),
    documents = before.documents.map { sheet -> sheet.copy(
        id = sheet.id.uppercase(), modelId = sheet.modelId?.uppercase(),
        content = sheet.content.copy(rows = sheet.content.rows.map(String::uppercase), columns = sheet.content.columns.map(String::uppercase), cells = sheet.content.cells.map {
            it.copy(rowId = it.rowId.uppercase(), columnId = it.columnId.uppercase())
        }),
        modelColumnBindings = sheet.modelColumnBindings.uppercaseKeys().mapValues { it.value.uppercase() },
        modelFormulaBindings = sheet.modelFormulaBindings?.uppercaseKeys(), columnNames = sheet.columnNames.uppercaseKeys(),
        sorting = sheet.sorting.map { it.copy(columnId = it.columnId.uppercase()) },
        presentation = sheet.presentation.copy(rowHeights = sheet.presentation.rowHeights.uppercaseKeys(), columnWidths = sheet.presentation.columnWidths.uppercaseKeys(),
            formatOverrides = sheet.presentation.formatOverrides.let { it.copy(rows = it.rows.uppercaseKeys(), columns = it.columns.uppercaseKeys(), cells = it.cells.uppercaseKeys()) }),
    ) },
    dataModels = before.dataModels.map { model -> model.copy(id = model.id.uppercase(), columns = model.columns.map { it.copy(id = it.id.uppercase()) }) },
)
