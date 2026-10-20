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

        val writes: List<() -> Unit> = listOf(
            { store.saveWorkbook(overridden) },
            { store.updateWorkbook { overridden } },
            { store.updateWorkbook { overridden.replaceSheet(overridden.documents.getValue(sheet.id).copy(modelFormulaBindings = null)) } },
        )
        writes.forEach { write ->
            val rejected = assertFailsWith<WorkbookApplicationException> { write() }
            assertEquals(WorkbookApplicationError.CALCULATED_CELL_WRITE, rejected.error)
            assertEquals(workbook, store.loadWorkbookBundle())
        }
    }

    private fun derivedLifecycleWorkbook(): WorkbookState {
        val base = lifecycleBoundWorkbook(lifecycleWorkbook())
        return base.copy(documents = base.documents.mapValues { (_, sheet) ->
            sheet.updateTabularContent { content ->
                content.rows.foldIndexed(content) { index, updated, row ->
                    updated.updateCell("B${index + 1}", "=@${content.columns[0].value}[${row.value}]*2")
                }
            }
        })
    }
}
