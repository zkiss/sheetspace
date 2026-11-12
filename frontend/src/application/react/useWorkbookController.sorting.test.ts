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
