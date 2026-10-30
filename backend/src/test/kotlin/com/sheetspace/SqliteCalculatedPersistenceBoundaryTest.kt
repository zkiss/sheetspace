package com.sheetspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SqliteCalculatedPersistenceBoundaryTest {
    @Test
    fun `ordinary store writes reject even a correctly derived calculated value`() = withSqliteStore { store ->
        val workbook = derivedLifecycleWorkbook()
        store.saveWorkbook(workbook)
        val sheet = workbook.sheetsInOrder.first()
        val row = sheet.tabularContent.rows.first()
        val output = sheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)

        val rejected = assertFailsWith<WorkbookApplicationException> {
            store.writeCells(listOf(ExpectedSheetRevision(sheet.id.value, 0)), listOf(SheetCellWrite(sheet.id.value, row.value, output.value, sheet.tabularContent.cellContents.getValue(CellCoordinate(row, output)))))
        }

        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejected.error)
        assertEquals(workbook, store.loadWorkbookBundle())
    }

    @Test
    fun `aggregate persistence rejects calculated overrides and binding removal`() = withSqliteStore { store ->
        val workbook = derivedLifecycleWorkbook()
        store.saveWorkbook(workbook)
        val sheet = workbook.sheetsInOrder.first()
        val overridden = workbook.replaceSheet(sheet.updateTabularContent { it.updateCell("B1", "=override") })

        val missingTemplates = overridden.replaceSheet(
            overridden.documents.getValue(sheet.id).copy(modelFormulaBindings = null),
        )
        val removedBinding = overridden.replaceSheet(
            overridden.documents.getValue(sheet.id).copy(
                modelColumnBindings = mapOf(LIFECYCLE_INPUT to sheet.tabularContent.columns.first()),
                modelFormulaBindings = emptyMap(),
            ),
        )
        val writes: List<() -> Unit> = listOf(
            { store.saveWorkbook(overridden) },
            { store.updateWorkbook { overridden } },
            { store.saveWorkbook(missingTemplates) },
            { store.updateWorkbook { missingTemplates } },
            { store.updateWorkbook { removedBinding } },
        )
        writes.forEach { write ->
            val rejected = assertFailsWith<WorkbookApplicationException> { write() }
            assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejected.error)
            assertEquals(workbook, store.loadWorkbookBundle())
        }
    }

    @Test
    fun `lifecycle binding rejects omitted calculated templates atomically`() = withSqliteStore { store ->
        val before = lifecycleWorkbook()
        store.saveWorkbook(before)
        val bound = lifecycleBoundWorkbook(before)
        val after = bound.copy(documents = bound.documents.mapValues { (_, sheet) ->
            sheet.copy(
                modelFormulaBindings = null,
                content = sheet.tabularContent.updateCell("B1", "=override"),
            )
        })

        val rejected = assertFailsWith<WorkbookApplicationException> {
            DefaultWorkbookApplication(store).saveModelLifecycle(before, after)
        }

        assertEquals(WorkbookApplicationError.INVALID_MODEL_LIFECYCLE, rejected.error)
        assertEquals(before, store.loadWorkbookBundle())
    }

    @Test
    fun `empty bound workbook requires calculated templates`() = withSqliteStore { store ->
        val bound = lifecycleBoundWorkbook(lifecycleWorkbook())
        val emptyWithoutTemplates = bound.copy(documents = bound.documents.mapValues { (_, sheet) ->
            sheet.copy(
                content = TabularContent(emptyList(), sheet.tabularContent.columns, emptyMap()),
                modelFormulaBindings = null,
            )
        })

        val rejected = assertFailsWith<WorkbookApplicationException> {
            store.saveWorkbook(emptyWithoutTemplates)
        }

        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejected.error)
        assertEquals(emptyWorkbookState(), store.loadWorkbookBundle())
    }

    @Test
    fun `a manual write paired with a calculated target is rejected without applying the manual write`() = withSqliteStore { store ->
        val workbook = derivedLifecycleWorkbook()
        store.saveWorkbook(workbook)
        val manualSheet = workbook.sheetsInOrder.first()
        val calculatedSheet = workbook.sheetsInOrder.last()
        val manualRow = manualSheet.tabularContent.rows.first()
        val manualColumn = manualSheet.tabularContent.columns.first()
        val calculatedRow = calculatedSheet.tabularContent.rows.first()
        val calculatedColumn = calculatedSheet.modelColumnBindings.getValue(LIFECYCLE_OUTPUT)

        val rejected = assertFailsWith<WorkbookApplicationException> {
            store.writeCells(
                listOf(
                    ExpectedSheetRevision(manualSheet.id.value, manualSheet.revision),
                    ExpectedSheetRevision(calculatedSheet.id.value, calculatedSheet.revision),
                ),
                listOf(
                    SheetCellWrite(manualSheet.id.value, manualRow.value, manualColumn.value, "manual"),
                    SheetCellWrite(calculatedSheet.id.value, calculatedRow.value, calculatedColumn.value, "=override"),
                ),
            )
        }

        assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejected.error)
        assertEquals(workbook, store.loadWorkbookBundle())
    }

    private fun derivedLifecycleWorkbook(): WorkbookState = lifecycleBoundWorkbook(lifecycleWorkbook())
}
