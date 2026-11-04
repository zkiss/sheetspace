import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

it('replays a pre-creation row order exactly after a queued opposite-axis append', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
  const [first, second] = sheet.content.rows;
  const firstResponse = deferred<{ sheetId: string; revision: number; columnCount: number; columnId: string }>();
  const secondResponse = deferred<{ sheetId: string; revision: number; columnCount: number; columnId: string }>();
  const appendColumn = vi.fn().mockImplementationOnce(() => firstResponse.promise).mockImplementationOnce(() => secondResponse.promise);
  let persisted = sheet;
  const writeAxisOrder = vi.fn(async (_id, _axis, order, revision) => {
    persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, rows: [...order] } };
    return structuredClone(persisted);
  });
  const api = autosaveClient({ appendColumn, writeAxisOrder, loadSheet: vi.fn(async () => structuredClone(persisted)) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => result.current.commands.shiftAxis('s', 'row', [first!], 1));
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  act(() => { result.current.commands.appendColumn('s'); result.current.commands.appendColumn('s'); });
  await waitFor(() => expect(appendColumn).toHaveBeenCalledTimes(1));
  await act(async () => firstResponse.reject(new Error('first failed')));
  await waitFor(() => expect(appendColumn).toHaveBeenCalledTimes(2));
  const before = structuredClone(result.current.workbook);
  act(() => result.current.commands.redo());
  expect(result.current.orderReplayFailure).toBe('pending-axis-creation');
  expect(result.current.canRedo).toBe(true);
  expect(result.current.canUndo).toBe(false);
  expect(result.current.workbook).toEqual(before);
  expect(writeAxisOrder).toHaveBeenCalledTimes(2);
  persisted = { ...persisted, revision: 3, content: { ...persisted.content, columns: [...persisted.content.columns, 'new-column'] } };
  await act(async () => secondResponse.resolve({ sheetId: 's', revision: 3, columnCount: 2, columnId: 'new-column' }));
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(persisted.content.rows).toEqual([second, first]);
  expect(persisted.content.columns).toContain('new-column');
  expect(result.current.canUndo).toBe(true);
  expect(result.current.canRedo).toBe(false);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(persisted.content.rows).toEqual([first, second]);
  expect(result.current.workbook.documents.s!.content.columns).toContain('new-column');
  expect(appendColumn).toHaveBeenCalledTimes(2);
});

it.each(['succeeds', 'fails'] as const)('retires a failed creation when its queued successor %s', async (outcome) => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
  const other = sheetDocument({ id: 't', name: 'Other', rowCount: 2, columnCount: 1 });
  const [first, second] = sheet.content.rows;
  const firstResponse = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
  const secondResponse = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
  let persisted = sheet;
  let persistedOther = other;
  const appendRow = vi.fn().mockImplementationOnce(() => firstResponse.promise).mockImplementationOnce(() => secondResponse.promise);
  const writeAxisOrder = vi.fn(async (_id, _axis, order, revision) => {
    if (_id === 't') {
      persistedOther = { ...persistedOther, revision: revision + 1, content: { ...persistedOther.content, rows: [...order] } };
      return structuredClone(persistedOther);
    }
    persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, rows: [...order] } };
    return structuredClone(persisted);
  });
  const api = autosaveClient({ appendRow, writeAxisOrder, loadSheet: vi.fn(async (id) => structuredClone(id === 't' ? persistedOther : persisted)) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet, other]), apiClient: api }));
  act(() => result.current.commands.shiftAxis('s', 'row', [first!], 1));
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  act(() => { result.current.commands.appendRow('s'); result.current.commands.appendRow('s'); });
  await waitFor(() => expect(appendRow).toHaveBeenCalledTimes(1));
  await act(async () => firstResponse.reject(new Error('first failed')));
  await waitFor(() => expect(appendRow).toHaveBeenCalledTimes(2));
  const before = structuredClone(result.current.workbook);
  act(() => {
    expect(result.current.commands.shiftAxis('s', 'row', [first!], -1)).toMatchObject({ status: 'rejected', reason: 'pending-axis-creation' });
    result.current.commands.undo();
  });
  expect(result.current.orderReplayFailure).toBe('pending-axis-creation');
  expect(result.current.canUndo).toBe(true);
  expect(result.current.canRedo).toBe(false);
  expect(result.current.workbook).toEqual(before);
  expect(writeAxisOrder).toHaveBeenCalledTimes(1);
  act(() => expect(result.current.commands.shiftAxis('t', 'row', [other.content.rows[0]!], 1).status).toBe('changed'));
  await waitFor(() => expect(persistedOther.content.rows).toEqual([...other.content.rows].reverse()));
  if (outcome === 'fails') {
    await act(async () => secondResponse.reject(new Error('second failed')));
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    act(() => expect(result.current.commands.shiftAxis('s', 'row', [first!], -1)).toMatchObject({ status: 'rejected', reason: 'pending-axis-creation' }));
    return;
  }
  persisted = { ...persisted, revision: 2, content: { ...persisted.content, rows: [second!, first!, 'new'] } };
  await act(async () => secondResponse.resolve({ sheetId: 's', revision: 2, rowCount: 3, rowId: 'new' }));
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(result.current.workbook.documents.s!.content.rows).toEqual([second, first, 'new']);
  act(() => expect(result.current.commands.shiftAxis('s', 'row', [first!], 1).status).toBe('changed'));
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(persisted.content.rows).toEqual([second, 'new', first]);
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(persisted.content.rows).toEqual([second, first, 'new']);
  act(() => result.current.commands.redo());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(persisted.content.rows).toEqual([second, 'new', first]);
  expect(appendRow).toHaveBeenCalledTimes(2);
});

it.each(['pending', 'failed'] as const)('settles %s order and its successor before appending', async (state) => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1 });
  const [a, b, c] = sheet.content.rows;
  let persisted = sheet;
  const pending = deferred<void>();
  let first = true;
  const writeAxisOrder = vi.fn(async (_id: string, _axis: 'row' | 'column', order: readonly string[], revision: number) => {
    if (first) {
      first = false;
      if (state === 'failed') throw new Error('offline');
      await pending.promise;
    }
    expect(revision).toBe(persisted.revision);
    persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, rows: [...order] } };
    return structuredClone(persisted);
  });
  const appendRow = vi.fn(async () => {
    persisted = { ...persisted, revision: persisted.revision + 1, content: { ...persisted.content, rows: [...persisted.content.rows, 'new'] } };
    return { sheetId: 's', revision: persisted.revision, rowCount: 4, rowId: 'new' };
  });
  const api = autosaveClient({ writeAxisOrder, appendRow, loadSheet: vi.fn(async () => structuredClone(persisted)) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => result.current.commands.shiftAxis('s', 'row', [a!], 1));
  await waitFor(() => expect(state === 'failed' ? result.current.saveStatus : writeAxisOrder.mock.calls.length).toBe(state === 'failed' ? 'failed' : 1));
  act(() => {
    result.current.commands.shiftAxis('s', 'row', [a!], 1);
    result.current.commands.appendRow('s');
  });
  expect(appendRow).not.toHaveBeenCalled();
  expect(result.current.workbook.documents.s!.content.rows).toEqual([b, c, a]);
  if (state === 'failed') act(() => result.current.commands.retryFailedSaves());
  else await act(async () => pending.resolve());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(appendRow).toHaveBeenCalledTimes(1);
  expect(persisted.content.rows).toEqual([b, c, a, 'new']);
  expect(result.current.workbook.documents.s!.content.rows).toEqual(persisted.content.rows);
  expect(persisted.revision).toBe(3);
});

it('rejects reorder during same-sheet creation until the appended identity is reconciled', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
  const [first, second] = sheet.content.rows;
  const response = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
  const appendRow = vi.fn(() => response.promise);
  const writeAxisOrder = vi.fn().mockImplementation(async (_id, _axis, order, revision) => ({
    ...sheet, revision: revision + 1, content: { ...sheet.content, rows: order },
  }));
  const loadSheet = vi.fn().mockResolvedValue({ ...sheet, revision: 1, content: { ...sheet.content, rows: [first, second, 'appended'] } });
  const api = autosaveClient({ appendRow, writeAxisOrder, loadSheet });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));

  act(() => {
    result.current.commands.appendRow('s');
    expect(result.current.commands.shiftAxis('s', 'row', [first!], 1)).toMatchObject({ status: 'rejected', reason: 'pending-axis-creation' });
  });
  expect(result.current.workbook.documents.s!.content.rows).toEqual([first, second]);
  expect(result.current.canUndo).toBe(false);
  expect(writeAxisOrder).not.toHaveBeenCalled();
  await act(async () => { response.resolve({ sheetId: 's', revision: 1, rowCount: 3, rowId: 'appended' }); });
  await waitFor(() => expect(result.current.workbook.documents.s!.content.rows).toEqual([first, second, 'appended']));
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  act(() => expect(result.current.commands.shiftAxis('s', 'row', [first!], 1).status).toBe('changed'));
  await waitFor(() => expect(writeAxisOrder).toHaveBeenCalledWith('s', 'row', [second, first, 'appended'], 1));
  expect(result.current.workbook.documents.s!.content.rows).toEqual([second, first, 'appended']);
});

it('preserves undo and redo while a same-sheet append is pending', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1 });
  const [first, second, third] = sheet.content.rows;
  const response = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
  let persisted = sheet;
  const api = autosaveClient({
    appendRow: vi.fn(() => response.promise),
    loadSheet: vi.fn(async () => structuredClone(persisted)),
    writeAxisOrder: vi.fn(async (_id, _axis, order, revision) => {
      persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, rows: [...order] } };
      return structuredClone(persisted);
    }),
  });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => result.current.commands.shiftAxis('s', 'row', [first!], 1));
  act(() => result.current.commands.undo());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  act(() => result.current.commands.appendRow('s'));
  const before = structuredClone(result.current.workbook);
  act(() => result.current.commands.redo());
  expect(result.current.orderReplayFailure).toBe('pending-axis-creation');
  expect(result.current.canRedo).toBe(true);
  expect(result.current.canUndo).toBe(false);
  expect(result.current.workbook).toEqual(before);
  expect(api.writeAxisOrder).toHaveBeenCalledTimes(2);
  expect(result.current.workbook.documents.s!.content.rows).toEqual([first, second, third]);
  await act(async () => response.resolve({ sheetId: 's', revision: 3, rowCount: 4, rowId: 'appended' }));
  await waitFor(() => expect(result.current.workbook.documents.s!.content.rows).toContain('appended'));
});

it('rejects moves and replay after failed creation until a replacement creation settles', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
  const [first, second] = sheet.content.rows;
  let persisted = sheet;
  const response = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
  const appendRow = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => response.promise);
  const writeAxisOrder = vi.fn(async (_id, _axis, order, revision) => {
    persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, rows: [...order] } };
    return structuredClone(persisted);
  });
  const api = autosaveClient({ appendRow, writeAxisOrder, loadSheet: vi.fn(async () => structuredClone(persisted)) });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => result.current.commands.shiftAxis('s', 'row', [first!], 1));
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  act(() => result.current.commands.appendRow('s'));
  await waitFor(() => expect(appendRow).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  act(() => expect(result.current.commands.shiftAxis('s', 'row', [first!], -1)).toMatchObject({ status: 'rejected', reason: 'pending-axis-creation' }));
  const before = structuredClone(result.current.workbook);
  act(() => result.current.commands.undo());
  expect(result.current.orderReplayFailure).toBe('pending-axis-creation');
  expect(result.current.canUndo).toBe(true);
  expect(result.current.canRedo).toBe(false);
  expect(result.current.workbook).toEqual(before);
  expect(writeAxisOrder).toHaveBeenCalledTimes(1);
  act(() => result.current.commands.appendRow('s'));
  await waitFor(() => expect(appendRow).toHaveBeenCalledTimes(2));
  persisted = { ...persisted, revision: 2, content: { ...persisted.content, rows: [second!, first!, 'new-row'] } };
  await act(async () => response.resolve({ sheetId: 's', revision: 2, rowCount: 3, rowId: 'new-row' }));
  await waitFor(() => expect(result.current.workbook.documents.s!.content.rows).toEqual([second, first, 'new-row']));
  act(() => result.current.commands.undo());
  expect(result.current.orderReplayFailure).toBe('order-conflict');
  expect(result.current.canUndo).toBe(true);
  expect(result.current.canRedo).toBe(false);
  expect(result.current.workbook.documents.s!.content.rows).toEqual([second, first, 'new-row']);
  act(() => expect(result.current.commands.shiftAxis('s', 'row', [first!], 1).status).toBe('changed'));
  await waitFor(() => expect(writeAxisOrder).toHaveBeenCalledWith('s', 'row', [second, 'new-row', first], 2));
});

it('blocks undo during column creation without blocking another sheet, then preserves the appended column', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 2 });
  const other = sheetDocument({ id: 't', name: 'Other', rowCount: 2, columnCount: 1 });
  const [first, second] = sheet.content.columns;
  const response = deferred<{ sheetId: string; revision: number; columnCount: number; columnId: string }>();
  const persisted = { s: sheet, t: other };
  const writeAxisOrder = vi.fn(async (id: string, axis: 'row' | 'column', order: readonly string[], revision: number) => {
    const current = persisted[id as 's' | 't'];
    const updated = { ...current, revision: revision + 1, content: { ...current.content, [axis === 'row' ? 'rows' : 'columns']: [...order] } };
    persisted[id as 's' | 't'] = updated;
    return structuredClone(updated);
  });
  const api = autosaveClient({
    appendColumn: vi.fn(() => response.promise),
    loadSheet: vi.fn(async (id) => structuredClone(persisted[id as 's' | 't'])),
    writeAxisOrder,
  });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet, other]), apiClient: api }));
  act(() => result.current.commands.shiftAxis('s', 'column', [first!], 1));
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  act(() => result.current.commands.appendColumn('s'));
  act(() => result.current.commands.undo());
  expect(result.current.orderReplayFailure).toBe('pending-axis-creation');
  expect(result.current.canUndo).toBe(true);
  expect(result.current.canRedo).toBe(false);
  expect(result.current.workbook.documents.s!.content.columns).toEqual([second, first]);
  expect(writeAxisOrder).toHaveBeenCalledTimes(1);
  act(() => expect(result.current.commands.shiftAxis('t', 'row', [other.content.rows[0]!], 1).status).toBe('changed'));
  await waitFor(() => expect(writeAxisOrder).toHaveBeenCalledTimes(2));
  persisted.s = { ...persisted.s, revision: 2, content: { ...persisted.s.content, columns: [second!, first!, 'appended'] } };
  await act(async () => response.resolve({ sheetId: 's', revision: 2, columnCount: 3, columnId: 'appended' }));
  await waitFor(() => expect(result.current.workbook.documents.s!.content.columns).toEqual([second, first, 'appended']));
  act(() => expect(result.current.commands.shiftAxis('s', 'column', [first!], 1).status).toBe('changed'));
  await waitFor(() => expect(writeAxisOrder).toHaveBeenCalledWith('s', 'column', [second, 'appended', first], 2));
});
