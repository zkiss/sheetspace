import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Workbook } from '@workbook/core/model';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { useWorkbookController } from './useWorkbookController';

it('applies and clears sorting as exact undoable aggregate transactions', async () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const workbook = workbookWithSheets([sheet]);
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  const criteria = [{ columnId: sheet.content.columns[0]!, direction: 'ascending' as const }];
  await act(async () => { await result.current.commands.configureSorting('s', criteria).completion; });
  expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  expect(result.current.workbook.documents.s!.sorting).toEqual(criteria);
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.s!.content.rows).toEqual(sheet.content.rows);
  expect(result.current.workbook.documents.s!.sorting).toBeUndefined();
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.canRedo).toBe(false));
  expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  await act(async () => { await result.current.commands.configureSorting('s', []).completion; });
  expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  const saves = vi.mocked(api.saveModelLifecycle).mock.calls.length;
  await act(async () => { await result.current.commands.configureSorting('s', []).completion; await result.current.commands.configureSorting('s', [{ columnId: 'missing', direction: 'ascending' }]).completion; });
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(saves);
});

it('rolls back an ambiguous sorting save and recovers the same transaction on retry', async () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const workbook = workbookWithSheets([sheet]);
  const save = deferred<Workbook>();
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockReturnValueOnce(save.promise).mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  let submission: ReturnType<typeof result.current.commands.configureSorting>;
  act(() => { submission = result.current.commands.configureSorting('s', [{ columnId: sheet.content.columns[0]!, direction: 'ascending' }]); });
  await act(async () => { save.reject(new Error('offline')); await submission!.completion; });
  expect(result.current.workbook.documents.s!.content.rows).toEqual(sheet.content.rows);
  expect(result.current.canUndo).toBe(false);
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
});

it('settles all active sheets in one request and replays their exact orders', async () => {
  const a = sheetDocument({ id: 'a', name: 'A', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const b = sheetDocument({ id: 'b', name: 'B', rowCount: 2, columnCount: 1, cells: { A1: '4', A2: '3' } });
  const workbook = workbookWithSheets([a, { ...b, sorting: [{ columnId: b.content.columns[0]!, direction: 'ascending' }] }]);
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  await act(async () => { await result.current.commands.configureSorting('a', [{ columnId: a.content.columns[0]!, direction: 'ascending' }]).completion; });
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
  expect(result.current.workbook.documents.a!.content.rows).toEqual([...a.content.rows].reverse());
  expect(result.current.workbook.documents.b!.content.rows).toEqual([...b.content.rows].reverse());
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.a!.content.rows).toEqual(a.content.rows);
  expect(result.current.workbook.documents.b!.content.rows).toEqual(b.content.rows);
});


it('redoes the recorded permutation without re-sorting positional keys', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 2, cells: { A1: '2', A2: '1' } });
  let workbook = workbookWithSheets([sheet]);
  for (const [cell, formula] of [['B1', '=@A[#1]'], ['B2', '=@A[#2]']]) {
    const document = workbook.documents.s!;
    const id = cellIdentityKey(cellIdentityAt(document.content, cell!)!);
    workbook = { ...workbook, documents: { ...workbook.documents, s: { ...document, content: { ...document.content, cells: { ...document.content.cells, [id]: prepareUserFormula(formula!, workbook, 's') } } } } };
  }
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  await act(async () => { await result.current.commands.configureSorting('s', [{ columnId: sheet.content.columns[1]!, direction: 'ascending' }]).completion; });
  const after = result.current.workbook.documents.s!.content.rows;
  expect(after).toEqual([...sheet.content.rows].reverse());
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.canRedo).toBe(false));
  expect(result.current.workbook.documents.s!.content.rows).toEqual(after);
});


it('keeps the undo cursor on a rejected replay and retries ambiguous replay exactly', async () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const workbook = workbookWithSheets([sheet]);
  const save = vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after);
  const api = autosaveClient({ saveModelLifecycle: save });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  await act(async () => { await result.current.commands.configureSorting('s', [{ columnId: sheet.content.columns[0]!, direction: 'ascending' }]).completion; });
  save.mockRejectedValueOnce(new WorkbookApiError('rejected', 400));
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  expect(result.current.canRedo).toBe(false);
  expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  save.mockRejectedValueOnce(new Error('offline'));
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRetryFailedSaves).toBe(true));
  expect(result.current.canRedo).toBe(false);
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.s!.content.rows).toEqual(sheet.content.rows);
});

it('preserves later frame presentation through sorting replay and does not sort on reload', async () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const workbook = workbookWithSheets([sheet]);
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  await act(async () => { await result.current.commands.configureSorting('s', [{ columnId: sheet.content.columns[0]!, direction: 'ascending' }]).completion; });
  const loaded = result.current.workbook;
  act(() => { result.current.commands.moveSheetFrame('s', { x: 41, y: 42 }); result.current.commands.undo(); });
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.s!.frame.position).toEqual({ x: 41, y: 42 });
  const reloadApi = autosaveClient();
  const reloaded = renderHook(() => useWorkbookController({ initialWorkbook: loaded, apiClient: reloadApi }));
  expect(reloaded.result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  expect(reloadApi.saveModelLifecycle).not.toHaveBeenCalled();
  expect(reloaded.result.current.canUndo).toBe(false);
});

it('rejects an oversized sorting transaction before publication or persistence', async () => {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const workbook = workbookWithSheets([{ ...sheet, name: 'x'.repeat(9 * 1024 * 1024) }]);
  const api = autosaveClient();
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  let submission: ReturnType<typeof result.current.commands.configureSorting>;
  act(() => { submission = result.current.commands.configureSorting('s', [{ columnId: sheet.content.columns[0]!, direction: 'ascending' }]); });
  expect(await submission!.completion).toEqual({ ok: false, reason: 'sorting-history-too-large' });
  expect(result.current.commands.currentWorkbook()).toBe(workbook);
  expect(result.current.canUndo).toBe(false);
  expect(api.saveModelLifecycle).not.toHaveBeenCalled();
});

it('returns the settled row order rather than the requested manual permutation', async () => {
  const base = sheetDocument({ id: 's', name: 'S', rowCount: 3, columnCount: 1, cells: { A1: '3', A2: '1', A3: '2' } });
  const sheet = { ...base, sorting: [{ columnId: base.content.columns[0]!, direction: 'ascending' as const }] };
  const [a, b, c] = sheet.content.rows;
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => {
    const move = result.current.commands.shiftAxis('s', 'row', [a!], 1);
    expect(move.status).toBe('changed');
    if (move.status === 'changed') {
      expect(move.before).toEqual([a, b, c]);
      expect(move.after).toEqual([b, c, a]);
      expect(move.workbook.documents.s!.content.rows).toEqual(move.after);
    }
  });
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
});

it('does not persist or record a row move fully reversed by sorting', () => {
  const base = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '1', A2: '2' } });
  const sheet = { ...base, sorting: [{ columnId: base.content.columns[0]!, direction: 'ascending' as const }] };
  const api = autosaveClient();
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => {
    const move = result.current.commands.shiftAxis('s', 'row', [sheet.content.rows[0]!], 1);
    expect(move.status).toBe('unchanged');
    expect(move.workbook.documents.s!.content.rows).toEqual(sheet.content.rows);
  });
  expect(result.current.canUndo).toBe(false);
  expect(api.saveModelLifecycle).not.toHaveBeenCalled();
  expect(api.writeAxisOrder).not.toHaveBeenCalled();
});

it('keeps induced changes on another sheet when the moved axis returns to its original order', async () => {
  const first = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '1', A2: '2' } });
  const second = sheetDocument({ id: 't', name: 'T', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const sorted = (sheet: typeof first) => ({ ...sheet, sorting: [{ columnId: sheet.content.columns[0]!, direction: 'ascending' as const }] });
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sorted(first), sorted(second)]), apiClient: api }));
  act(() => {
    const move = result.current.commands.shiftAxis('s', 'row', [first.content.rows[0]!], 1);
    expect(move.status).toBe('changed');
    if (move.status === 'changed') {
      expect(move.before).toEqual(first.content.rows);
      expect(move.after).toEqual(first.content.rows);
      expect(move.workbook.documents.s!.content.rows).toEqual(move.after);
      expect(move.workbook.documents.t!.content.rows).toEqual([...second.content.rows].reverse());
    }
  });
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.t!.content.rows).toEqual(second.content.rows);
});

it('settles a manual column move with stable criteria and exact semantic replay', async () => {
  const base = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 2, cells: { A1: '2', A2: '1' } });
  const context = workbookWithSheets([base]);
  for (const [cell, formula] of [['B1', '=@A[#1]'], ['B2', '=@A[#2]']]) {
    base.content.cells[cellIdentityKey(cellIdentityAt(base.content, cell!)!)] = prepareUserFormula(formula!, context, 's');
  }
  const criteria = [{ columnId: base.content.columns[1]!, direction: 'ascending' as const }];
  const sheet = { ...base, sorting: criteria };
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => expect(result.current.commands.shiftAxis('s', 'column', [sheet.content.columns[0]!], 1).status).toBe('changed'));
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  const after = result.current.workbook.documents.s!;
  expect(after.content.columns).toEqual([...sheet.content.columns].reverse());
  expect(after.content.rows).toEqual([...sheet.content.rows].reverse());
  expect(after.sorting).toEqual(criteria);
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
  expect(api.writeAxisOrder).not.toHaveBeenCalled();
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.s!.content).toEqual(sheet.content);
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.canRedo).toBe(false));
  expect(result.current.workbook.documents.s!.content).toEqual(after.content);
});

it('deletes a sheet and settles surviving sorting in one replayable aggregate', async () => {
  const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '1' } });
  const base = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A2: '2' } });
  let workbook = workbookWithSheets([source, base]);
  const identity = cellIdentityKey(cellIdentityAt(base.content, 'A1')!);
  const sheet = { ...base, sorting: [{ columnId: base.content.columns[0]!, direction: 'ascending' as const }], content: { ...base.content, cells: { ...base.content.cells, [identity]: prepareUserFormula('=@Source!A[1]', workbook, 's') } } };
  workbook = workbookWithSheets([source, sheet]);
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => expect(result.current.commands.deleteSheet('source').ok).toBe(true));
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  expect(result.current.workbook.documents.source).toBeUndefined();
  expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  expect(api.saveModelLifecycle).toHaveBeenCalledTimes(1);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.source).toBeDefined();
  expect(result.current.workbook.documents.s!.content.rows).toEqual(sheet.content.rows);
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.canRedo).toBe(false));
  expect(result.current.workbook.documents.source).toBeUndefined();
  expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
});

it('rejects sorted axis moves and sheet deletion while an unrelated axis creation is pending', () => {
  const sorted = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 2 });
  const other = sheetDocument({ id: 'o', name: 'O' });
  const workbook = workbookWithSheets([{ ...sorted, sorting: [{ columnId: sorted.content.columns[0]!, direction: 'ascending' }] }, other]);
  const creation = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
  const api = autosaveClient({ appendRow: () => creation.promise });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => result.current.commands.appendRow('o'));
  const before = result.current.commands.currentWorkbook();
  act(() => {
    expect(result.current.commands.shiftAxis('s', 'column', [sorted.content.columns[0]!], 1)).toMatchObject({ status: 'rejected', reason: 'pending-axis-creation' });
    expect(result.current.commands.deleteSheet('s')).toEqual({ ok: false, reason: 'pending-axis-creation' });
  });
  expect(result.current.commands.currentWorkbook()).toBe(before);
  expect(api.saveModelLifecycle).not.toHaveBeenCalled();
  expect(api.writeAxisOrder).not.toHaveBeenCalled();
});

it('drains an older sheet write before an aggregate sorted deletion', async () => {
  const sorted = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1 });
  const other = sheetDocument({ id: 'o', name: 'O' });
  const workbook = workbookWithSheets([{ ...sorted, sorting: [{ columnId: sorted.content.columns[0]!, direction: 'ascending' }] }, other]);
  const write = deferred<{ sheetId: string; revision: number }>();
  const api = autosaveClient({ updateSheetPosition: vi.fn().mockReturnValue(write.promise), saveModelLifecycle: vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => result.current.commands.moveSheetFrame('o', { x: 10, y: 20 }));
  await waitFor(() => expect(api.updateSheetPosition).toHaveBeenCalledOnce());
  act(() => expect(result.current.commands.deleteSheet('o').ok).toBe(true));
  expect(api.saveModelLifecycle).not.toHaveBeenCalled();
  await act(async () => write.resolve({ sheetId: 'o', revision: 1 }));
  await waitFor(() => expect(api.saveModelLifecycle).toHaveBeenCalledOnce());
  expect(api.updateSheetPosition).toHaveBeenCalledOnce();
  await waitFor(() => expect(result.current.canUndo).toBe(true));
});

it('rolls back a rejected sorted deletion without recording history', async () => {
  const sorted = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const other = sheetDocument({ id: 'o', name: 'O' });
  const workbook = workbookWithSheets([{ ...sorted, sorting: [{ columnId: sorted.content.columns[0]!, direction: 'ascending' }] }, other]);
  const api = autosaveClient({ saveModelLifecycle: vi.fn().mockRejectedValue(new WorkbookApiError('rejected', 400)) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbook, apiClient: api }));
  act(() => expect(result.current.commands.deleteSheet('o').ok).toBe(true));
  await waitFor(() => expect(result.current.workbook.documents.o).toBeDefined());
  expect(result.current.workbook.documents.s!.content.rows).toEqual(sorted.content.rows);
  expect(result.current.canUndo).toBe(false);
});
