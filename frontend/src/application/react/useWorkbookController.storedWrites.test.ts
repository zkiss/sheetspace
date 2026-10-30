import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { decodeStoredFormula } from '@workbook/formula/storedFormula';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';
import { cellRawContent } from '@workbook/read/queries';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';

describe('trusted controller writes', () => {
  it('preserves an unchanged reference when an editor corrects another part of a formula', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '4' } });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]) }));
    act(() => { result.current.commands.updateCellContent(sheet.id, 'B1', '=@A[1]+@Missing!A[1]'); });
    const before = cellRawContent(result.current.workbook.documents.sheet, 'B1')!;
    act(() => { result.current.commands.updateCellContent(sheet.id, 'B1', '=@A[1]+3'); });
    const after = cellRawContent(result.current.workbook.documents.sheet, 'B1')!;
    expect(decodeStoredFormula(after).occurrences[0].slots).toEqual(decodeStoredFormula(before).occurrences[0].slots);
    expect(result.current.formulaResults.sheet.B1).toMatchObject({ value: 7 });
  });
  it('calculates against the request workbook when a later rename advances the optimistic workbook', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '7' } });
    const target = sheetDocument({ id: 'target', name: 'Target', rowCount: 1, columnCount: 1 });
    const workbook = workbookWithSheets([source, target]);
    const update = vi.spyOn(FormulaCalculation.prototype, 'updateStored');
    const { result, unmount } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));
    update.mockClear();

    act(() => {
      result.current.commands.updateCellContent('target', 'A1', '=@Source!A[1]');
      result.current.commands.renameSheet('source', 'Renamed');
    });

    expect(result.current.workbook.documents.source.name).toBe('Renamed');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1].documents.source.name).toBe('Source');
    expect(result.current.formulaResults.target.A1).toMatchObject({ value: 7 });
    unmount();
    update.mockRestore();
  });
  it('prepares fresh mixed invalid input once and calculates diagnostics without erasing it', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2, cells: { A1: '4' } });
    const workbook = workbookWithSheets([sheet]);
    const text = '=@A[1]+@Missing!A[1]+@A[bad]';
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));

    act(() => { result.current.commands.updateCellContent(sheet.id, 'B1', text); });

    const stored = cellRawContent(result.current.workbook.documents.sheet, 'B1')!;
    const decoded = decodeStoredFormula(stored);
    expect(decoded.text).toBe(text);
    expect(decoded.occurrences[0].slots.find((slot) => slot.kind === 'column')?.targetIds).toEqual([sheet.content.columns[0]]);
    expect(projectStoredFormula(stored, result.current.workbook, sheet.id).text).toBe(text);
    expect(result.current.formulaResults.sheet.B1).toMatchObject({ kind: 'error' });
    act(() => { result.current.commands.undo(); result.current.commands.redo(); });
    expect(cellRawContent(result.current.workbook.documents.sheet, 'B1')).toBe(stored);
  });

  it('treats an exact envelope entered through the editor as literal fresh formula text', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 2 });
    const workbook = workbookWithSheets([sheet]);
    const envelope = prepareUserFormula('=@A[1]', workbook, sheet.id);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));

    act(() => { result.current.commands.updateCellContent(sheet.id, 'B1', envelope); });

    const stored = cellRawContent(result.current.workbook.documents.sheet, 'B1')!;
    expect(decodeStoredFormula(stored)).toEqual({ text: envelope, occurrences: [] });
    expect(projectStoredFormula(stored, result.current.workbook, sheet.id).text).toBe(envelope);
    expect(result.current.formulaResults.sheet.B1).toMatchObject({ error: '#PARSE!' });
  });

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

  it('copies a translated stored formula and restores exact contents through undo and redo', () => {
    const sheet = sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 2, columnCount: 4 });
    const workbook = workbookWithSheets([sheet]);
    const raw = prepareUserFormula('=@A[1]+@Missing!A[0]', workbook, sheet.id);
    const source = cellIdentityAt(sheet.content, 'B1')!;
    const target = cellIdentityAt(sheet.content, 'C1')!;
    const clipboard = { ok: true as const, value: { kind: 'internal' as const,
      grid: { rows: [[raw]], rowCount: 1, columnCount: 1 },
      source: { sheetId: sheet.id, dimensions: { rowCount: 1, columnCount: 1 }, cells: [[{ identity: source, raw }]] } } };
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook }));

    act(() => { expect(result.current.commands.pasteStoredCells(sheet.id, 'C1', clipboard)).toEqual({ ok: true, changed: true }); });
    const copied = result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(target)]!;
    const decoded = decodeStoredFormula(copied);
    expect(decoded.text).toBe('=@B[1]+@Missing!A[0]');
    expect(decoded.occurrences[0].slots.find((slot) => slot.kind === 'column')?.targetIds).toEqual([sheet.content.columns[1]]);
    expect(decoded.occurrences[1]).toEqual(decodeStoredFormula(raw).occurrences[1]);
    act(() => { result.current.commands.undo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(target)]).toBeUndefined();
    act(() => { result.current.commands.redo(); });
    expect(result.current.workbook.documents[sheet.id]!.content.cells[cellIdentityKey(target)]).toBe(copied);
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
