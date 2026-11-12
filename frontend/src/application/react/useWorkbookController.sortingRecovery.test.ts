import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Workbook } from '@workbook/core/model';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

function setup() {
  const sheet = sheetDocument({ id: 's', name: 'S', rowCount: 2, columnCount: 1, cells: { A1: '2', A2: '1' } });
  const save = vi.fn().mockImplementation(async (_before: Workbook, after: Workbook) => after);
  const api = autosaveClient({ saveModelLifecycle: save });
  const hook = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  const criteria = [{ columnId: sheet.content.columns[0]!, direction: 'ascending' as const }];
  return { sheet, save, api, criteria, ...hook };
}

it('fences edits during ambiguous configuration and its deferred exact-payload retry', async () => {
  const { sheet, save, api, criteria, result } = setup();
  const retry = deferred<Workbook>();
  save.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(retry.promise);
  let submission: ReturnType<typeof result.current.commands.configureSorting>;
  act(() => { submission = result.current.commands.configureSorting('s', criteria); });
  await act(async () => { await submission!.completion; });
  const rolledBack = result.current.commands.currentWorkbook();
  const assertFenced = () => {
    expect(result.current.commands.moveSheetFrame('s', { x: 41, y: 42 })).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(result.current.commands.updateCellContent('s', 'A1', '99')).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(result.current.commands.currentWorkbook()).toEqual(rolledBack);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  };
  act(assertFenced);
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  act(assertFenced);
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  expect(api.writeCells).not.toHaveBeenCalled();
  expect(api.updateSheetPosition).not.toHaveBeenCalled();
  await act(async () => retry.resolve(save.mock.calls[1]![1]));
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  expect(result.current.workbook.documents.s!.content.rows).toEqual([...sheet.content.rows].reverse());
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.canUndo).toBe(false);
});

it.each(['undo', 'redo'] as const)('fences edits and cursor during ambiguous %s recovery', async (direction) => {
  const { sheet, save, api, criteria, result } = setup();
  await act(async () => { await result.current.commands.configureSorting('s', criteria).completion; });
  act(() => result.current.commands.moveSheetFrame('s', { x: 41, y: 42 }));
  await waitFor(() => expect(api.updateSheetPosition).toHaveBeenCalled());
  if (direction === 'redo') {
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.canRedo).toBe(true));
  }
  const retry = deferred<Workbook>();
  save.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(retry.promise);
  act(() => result.current.commands[direction]());
  await waitFor(() => expect(result.current.canRetryFailedSaves).toBe(true));
  const rolledBack = result.current.commands.currentWorkbook();
  const callIndex = save.mock.calls.length - 1;
  const assertFenced = () => {
    expect(result.current.commands.updateCellContent('s', 'A1', '99')).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(result.current.commands.moveSheetFrame('s', { x: 90, y: 91 })).toEqual({ ok: false, reason: 'pending-model-transition' });
    result.current.commands.undo();
    result.current.commands.redo();
    expect(result.current.commands.currentWorkbook()).toEqual(rolledBack);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  };
  act(assertFenced);
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(save).toHaveBeenCalledTimes(callIndex + 2));
  act(assertFenced);
  expect(save.mock.calls[callIndex + 1]).toEqual(save.mock.calls[callIndex]);
  expect(api.writeCells).not.toHaveBeenCalled();
  await act(async () => retry.resolve(save.mock.calls[callIndex + 1]![1]));
  await waitFor(() => expect(direction === 'undo' ? result.current.canRedo : result.current.canUndo).toBe(true));
  expect(result.current.workbook.documents.s!.content.rows).toEqual(direction === 'undo' ? sheet.content.rows : [...sheet.content.rows].reverse());
  expect(result.current.workbook.documents.s!.sorting).toEqual(direction === 'undo' ? undefined : criteria);
  expect(result.current.workbook.documents.s!.frame.position).toEqual({ x: 41, y: 42 });
  const savesBeforeEdit = save.mock.calls.length;
  act(() => result.current.commands.updateCellContent('s', 'A1', '99'));
  await waitFor(() => expect(direction === 'undo' ? api.writeCells : save).toHaveBeenCalledTimes(direction === 'undo' ? 1 : savesBeforeEdit + 1));
  await waitFor(() => expect(result.current.canUndo).toBe(true));
  act(() => result.current.commands.undo());
  await waitFor(() => expect(direction === 'undo' ? api.writeCells : save).toHaveBeenCalledTimes(direction === 'undo' ? 2 : savesBeforeEdit + 2));
  await waitFor(() => expect(result.current.canRedo).toBe(true));
  expect(result.current.workbook.documents.s!.content.rows).toEqual(direction === 'undo' ? sheet.content.rows : [...sheet.content.rows].reverse());
  act(() => result.current.commands.redo());
  await waitFor(() => expect(direction === 'undo' ? api.writeCells : save).toHaveBeenCalledTimes(direction === 'undo' ? 3 : savesBeforeEdit + 3));
  expect(result.current.workbook.documents.s!.frame.position).toEqual({ x: 41, y: 42 });
});

it('releases an initial conflict but retains the fence after a conflict on ambiguous retry', async () => {
  const { save, criteria, result } = setup();
  save.mockRejectedValueOnce(new WorkbookApiError('conflict', 409));
  await act(async () => { await result.current.commands.configureSorting('s', criteria).completion; });
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRetryFailedSaves).toBe(false);
  expect(result.current.commands.moveSheetFrame('s', { x: 0, y: 0 })).not.toEqual({ ok: false, reason: 'pending-model-transition' });
  save.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new WorkbookApiError('conflict', 409));
  await act(async () => { await result.current.commands.configureSorting('s', criteria).completion; });
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(result.current.canRetryFailedSaves).toBe(true));
  expect(save.mock.calls[2]).toEqual(save.mock.calls[1]);
  expect(result.current.commands.updateCellContent('s', 'A1', '99')).toEqual({ ok: false, reason: 'pending-model-transition' });
  expect(result.current.canUndo).toBe(false);
});
