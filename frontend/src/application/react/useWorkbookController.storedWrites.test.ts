import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { decodeStoredFormula } from '@workbook/formula/storedFormula';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

describe('trusted controller writes', () => {
  it('moves stored content and dependent bindings atomically through undo and redo', () => {
    const base = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 4 });
    const initial = workbookWithSheets([base]);
    const moved = prepareUserFormula('=@D[1]+@Missing!A[0]', initial, base.id);
    const dependent = prepareUserFormula('=@A[1]+@Missing!A[0]', initial, base.id);
    const a = cellIdentityAt(base.content, 'A1')!;
    const b = cellIdentityAt(base.content, 'B1')!;
    const c = cellIdentityAt(base.content, 'C1')!;
    const sheet = { ...base, content: { ...base.content, cells: { [cellIdentityKey(a)]: moved, [cellIdentityKey(c)]: dependent } } };
    const workbook = workbookWithSheets([sheet]);
    const source = { sheetId: sheet.id, dimensions: { rowCount: 1, columnCount: 1 }, cells: [[{ identity: a, raw: moved }]] };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    act(() => { expect(result.current.commands.moveStoredCells(sheet.id, 'B1', source)).toEqual({ ok: true, changed: true }); });
    const cells = result.current.workbook.documents[sheet.id]!.content.cells;
    const afterMoved = cells[cellIdentityKey(b)]!;
    const afterDependent = cells[cellIdentityKey(c)]!;
    expect(decodeStoredFormula(afterMoved).text).toBe('=@D[1]+@Missing!A[0]');
    expect(decodeStoredFormula(afterDependent).text).toBe('=@B[1]+@Missing!A[0]');
    act(() => { result.current.commands.undo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(a)]).toBe(moved);
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(c)]).toBe(dependent);
    act(() => { result.current.commands.redo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(b)]).toBe(afterMoved);
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(c)]).toBe(afterDependent);
  });
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
