import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CellWriteResult } from '@application/core/userActions';
import { cellTargetAt } from '@grid/cellInteraction';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useCellEditing } from '@grid/useCellEditing';

/** A sheet whose first column the model calculates and whose second column holds manual input. */
function calculatedSheetWorkbook() {
  const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', rowCount: 1, columnCount: 2, cells: { A1: '=SUM(@B[1])', B1: '3' } });
  const bound = {
    ...sheet,
    modelId: 'model',
    modelColumnBindings: { total: sheet.content.columns[0]!, input: sheet.content.columns[1]! },
  };
  return {
    sheet: bound,
    workbook: {
      ...workbookWithSheets([bound]),
      dataModels: {
        model: {
          id: 'model',
          name: 'Model',
          columns: [
            { id: 'total', name: 'Total', kind: 'calculated' as const, type: 'float' as const, formula: '=SUM(@B[1])' },
            { id: 'input', name: 'Input', kind: 'manual' as const, type: 'float' as const },
          ],
        },
      },
    },
  };
}

describe('useCellEditing calculated-cell protection', () => {
  it('refuses to clear a calculated column and reports a rejected mixed range', () => {
    const { sheet, workbook } = calculatedSheetWorkbook();
    const calculatedColumnId = sheet.content.columns[0]!;
    const commands = {
      updateCellContent: vi.fn(),
      writeCells: vi.fn((writes: readonly { columnId: string }[]): CellWriteResult => (
        writes.some((write) => write.columnId === calculatedColumnId)
          ? { ok: false, reason: 'calculated-cell-write' }
          : { ok: true, changed: true }
      )),
    };
    const { result } = renderHook(() => useCellEditing({ commands, workbook }));
    const a1 = cellTargetAt(sheet, 'A1')!;
    const b1 = cellTargetAt(sheet, 'B1')!;

    let outcome = result.current.clearCellContent(a1);
    expect(outcome).toEqual({ ok: false, reason: 'calculated-cell-write' });
    expect(commands.writeCells).not.toHaveBeenCalled();

    act(() => result.current.selectCell(a1));
    act(() => result.current.extendSelection(b1));
    outcome = result.current.clearCellContent(b1);

    expect(commands.writeCells).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ ok: false, reason: 'calculated-cell-write' });
    expect(result.current.selectionRange).toEqual({ mode: 'cells', anchor: a1, extent: b1 });
  });
});
