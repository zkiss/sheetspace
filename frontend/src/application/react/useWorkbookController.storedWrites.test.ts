import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

describe('trusted controller writes', () => {
  it('admits an unchanged internal snapshot without preparing its formula again', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const raw = prepareUserFormula('=@A[1]+@Missing!A[0]', workbook, sheet.id);
    const identity = { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! };
    const clipboard = { ok: true as const, value: { kind: 'internal' as const,
      grid: { rows: [[raw]], rowCount: 1, columnCount: 1 },
      source: { sheetId: sheet.id, dimensions: { rowCount: 1, columnCount: 1 }, cells: [[{ identity, raw }]] } } };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => { expect(result.current.commands.pasteStoredCells(sheet.id, 'B1', clipboard)).toEqual({ ok: true, changed: true }); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(identity)]).toBe(raw);
    act(() => { result.current.commands.undo(); });
    act(() => { result.current.commands.redo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(identity)]).toBe(raw);
  });

  it('retains stored formula metadata through undo and redo', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const raw = prepareUserFormula('=@A[1]+@Missing!A[0]', workbook, sheet.id);
    const cell = { sheetId: sheet.id, rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => { result.current.commands.writeStoredCells([{ ...cell, raw }]); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(cell)]).toBe(raw);
    act(() => { result.current.commands.undo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(cell)]).toBeUndefined();
    act(() => { result.current.commands.redo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(cell)]).toBe(raw);
  });
});
