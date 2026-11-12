import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Workbook } from '@workbook/core/model';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { autosaveClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

function fixture() {
  const a = sheetDocument({ id: 'a', name: 'A', rowCount: 2, columnCount: 1, cells: { A1: '1', A2: '2' } });
  const b = sheetDocument({ id: 'b', name: 'B', rowCount: 2, columnCount: 1, cells: { A1: '4', A2: '3' } });
  const sorted = (sheet: typeof a) => ({ ...sheet, sorting: [{ columnId: sheet.content.columns[0]!, direction: 'ascending' as const }] });
  return { a, b, workbook: workbookWithSheets([sorted(a), sorted(b)]) };
}

it('settles a stable cell write and both active sheet orders in one exact history step', async () => {
  const { a, b, workbook } = fixture();
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => expect(result.current.commands.writeCells([{ sheetId: 'a', rowId: a.content.rows[0]!, columnId: a.content.columns[0]!, raw: '5' }])).toEqual({ ok: true, changed: true }));
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  const after = structuredClone(result.current.workbook);
  expect(after.documents.a!.content.rows).toEqual([...a.content.rows].reverse());
  expect(after.documents.b!.content.rows).toEqual([...b.content.rows].reverse());
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
  expect(api.writeCells).not.toHaveBeenCalled();
  expect(api.writeAxisOrder).not.toHaveBeenCalled();
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.a!.content).toEqual(workbook.documents.a!.content);
  expect(result.current.workbook.documents.b!.content.rows).toEqual(b.content.rows);
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.canRedo).toBe(false));
  expect(result.current.workbook.documents.a!.content).toEqual(after.documents.a!.content);
  expect(result.current.workbook.documents.b!.content.rows).toEqual(after.documents.b!.content.rows);
});

it('does not publish invalid or unchanged writes and rolls back a definite save failure', async () => {
  const { a, workbook } = fixture();
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockRejectedValue(new WorkbookApiError('rejected', 400)) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => {
    expect(result.current.commands.writeCells([{ sheetId: 'missing', rowId: 'x', columnId: 'y', raw: '1' }]).ok).toBe(false);
    expect(result.current.commands.writeCells([{ sheetId: 'a', rowId: a.content.rows[0]!, columnId: a.content.columns[0]!, raw: '1' }])).toEqual({ ok: true, changed: false });
  });
  expect(api.saveModelLifecycle).not.toHaveBeenCalled();
  act(() => { result.current.commands.writeCells([{ sheetId: 'a', rowId: a.content.rows[0]!, columnId: a.content.columns[0]!, raw: '5' }]); });
  await waitFor(() => expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.workbook.documents.a!.content).toEqual(workbook.documents.a!.content));
  expect(result.current.canUndo).toBe(false);
});

it('rejects an oversized final snapshot without publishing or saving', () => {
  const { a, workbook } = fixture();
  const large = { ...workbook, documents: { ...workbook.documents, a: { ...workbook.documents.a!, name: 'x'.repeat(9 * 1024 * 1024) } } };
  const api = autosaveClient();
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: large, apiClient: api }));
  act(() => expect(result.current.commands.writeCells([{ sheetId: 'a', rowId: a.content.rows[0]!, columnId: a.content.columns[0]!, raw: '5' }])).toEqual({ ok: false, reason: 'sorting-history-too-large' }));
  expect(result.current.commands.currentWorkbook()).toBe(large);
  expect(api.saveModelLifecycle).not.toHaveBeenCalled();
});

it('rejects another write while the sorted transaction is pending', () => {
  const { a, workbook } = fixture();
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockReturnValue(new Promise(() => {})) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  const write = { sheetId: 'a', rowId: a.content.rows[0]!, columnId: a.content.columns[0]!, raw: '5' };
  act(() => {
    expect(result.current.commands.writeStoredCells([write])).toEqual({ ok: true, changed: true });
    expect(result.current.commands.writeCells([{ ...write, raw: '6' }])).toEqual({ ok: false, reason: 'pending-model-transition' });
  });
  expect(api.writeCells).not.toHaveBeenCalled();
});

it('replays the recorded write permutation without re-sorting positional keys', async () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 2, cells: { A1: '2', A2: '1' } });
  let workbook = workbookWithSheets([{ ...sheet, sorting: [{ columnId: sheet.content.columns[1]!, direction: 'ascending' }] }]);
  for (const [cell, formula] of [['B1', '=@A[#1]'], ['B2', '=@A[#2]']]) {
    const document = workbook.documents.s!;
    const id = cellIdentityKey(cellIdentityAt(document.content, cell!)!);
    workbook = { ...workbook, documents: { ...workbook.documents, s: { ...document, content: { ...document.content, cells: { ...document.content.cells, [id]: prepareUserFormula(formula!, workbook, 's') } } } } };
  }
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => { result.current.commands.updateCellContent('s', 'A2', '0'); });
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  const after = structuredClone(result.current.workbook.documents.s!.content);
  expect(after.rows).toEqual([...sheet.content.rows].reverse());
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.s!.content).toEqual(workbook.documents.s!.content);
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.canRedo).toBe(false));
  expect(result.current.workbook.documents.s!.content).toEqual(after);
});
