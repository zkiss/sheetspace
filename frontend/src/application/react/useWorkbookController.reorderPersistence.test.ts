import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';

it('queues immediate moves and history replay behind a pending order save', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 2 });
  const [a, b, c] = sheet.content.rows;
  const [x, y] = sheet.content.columns;
  let persisted = sheet;
  const pending = deferred<void>();
  const loadSheet = vi.fn(async () => structuredClone(persisted));
  const writeAxisOrder = vi.fn(async (_id: string, axis: 'row' | 'column', order: readonly string[], revision: number) => {
    if (revision === 0) await pending.promise;
    expect(revision).toBe(persisted.revision);
    persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, [axis === 'row' ? 'rows' : 'columns']: [...order] } };
    return structuredClone(persisted);
  });
  const api = autosaveClient({ loadSheet, writeAxisOrder });
  const { result, unmount } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));

  act(() => expect(result.current.commands.shiftAxis('s', 'row', [a!], 1).status).toBe('changed'));
  await waitFor(() => expect(writeAxisOrder).toHaveBeenCalledTimes(1));
  act(() => {
    expect(result.current.commands.shiftAxis('s', 'row', [a!], 1).status).toBe('changed');
    expect(result.current.commands.gatherAxis('s', 'column', [x!], 2).status).toBe('changed');
  });
  expect(result.current.workbook.documents.s!.content.rows).toEqual([b, c, a]);
  expect(result.current.workbook.documents.s!.content.columns).toEqual([y, x]);
  expect(result.current.saveStatus).toBe('saving');
  act(() => result.current.commands.undo());
  act(() => result.current.commands.redo());
  await act(async () => pending.resolve());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(writeAxisOrder).toHaveBeenCalledTimes(5);
  expect(persisted.content.rows).toEqual([b, c, a]);
  expect(persisted.content.columns).toEqual([y, x]);
  expect(result.current.workbook.documents.s!.revision).toBe(5);
  unmount();
  const reloaded = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([persisted]) }));
  expect(reloaded.result.current.workbook.documents.s!.content).toEqual(persisted.content);
});

it('retries a failed move before saving its optimistic successor', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1 });
  const [a, b, c] = sheet.content.rows;
  let persisted = sheet;
  let fail = true;
  const loadSheet = vi.fn(async () => structuredClone(persisted));
  const writeAxisOrder = vi.fn(async (_id: string, _axis: 'row' | 'column', order: readonly string[], revision: number) => {
    if (fail) { fail = false; throw new Error('offline'); }
    expect(revision).toBe(persisted.revision);
    persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, rows: [...order] } };
    return structuredClone(persisted);
  });
  const api = autosaveClient({ loadSheet, writeAxisOrder });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => result.current.commands.shiftAxis('s', 'row', [a!], 1));
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  act(() => result.current.commands.shiftAxis('s', 'row', [a!], 1));
  expect(result.current.workbook.documents.s!.content.rows).toEqual([b, c, a]);
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(persisted.content.rows).toEqual([b, c, a]);
  expect(persisted.revision).toBe(2);
});

it('recovers a revision conflict without replacing the optimistic successor', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1 });
  const [a, b, c] = sheet.content.rows;
  let persisted = sheet;
  let conflict = true;
  const loadSheet = vi.fn(async () => structuredClone(persisted));
  const writeAxisOrder = vi.fn(async (_id: string, _axis: 'row' | 'column', order: readonly string[], revision: number) => {
    if (conflict) {
      conflict = false;
      persisted = { ...persisted, revision: 1 };
      throw new WorkbookApiError('conflict', 409, 'sheet-revision-conflict');
    }
    expect(revision).toBe(persisted.revision);
    persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, rows: [...order] } };
    return structuredClone(persisted);
  });
  const api = autosaveClient({ loadSheet, writeAxisOrder });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => {
    result.current.commands.shiftAxis('s', 'row', [a!], 1);
    result.current.commands.shiftAxis('s', 'row', [a!], 1);
  });
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(persisted.content.rows).toEqual([b, c, a]);
  expect(result.current.workbook.documents.s!.content.rows).toEqual([b, c, a]);
  expect(result.current.workbook.documents.s!.revision).toBe(3);
});
