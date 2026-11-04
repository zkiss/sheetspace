import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';

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
  act(() => result.current.commands.redo());
  expect(result.current.orderReplayFailure).toBe('pending-axis-creation');
  expect(result.current.canRedo).toBe(true);
  expect(result.current.workbook.documents.s!.content.rows).toEqual([first, second, third]);
  await act(async () => response.resolve({ sheetId: 's', revision: 3, rowCount: 4, rowId: 'appended' }));
  await waitFor(() => expect(result.current.workbook.documents.s!.content.rows).toContain('appended'));
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
