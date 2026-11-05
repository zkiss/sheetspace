import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { useWorkbookController } from './useWorkbookController';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { cellIdentityKey } from '@workbook/core/cellIdentity';

it('queues immediate moves and history replay behind a pending order save', async () => {
  const base = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 2, cells: { A1: '42', B2: '=A1' } });
  const sheet = {
    ...base,
    columnNames: { [base.content.columns[0]!]: 'Revenue' },
    presentation: {
      rowHeights: { [base.content.rows[0]!]: 44 },
      columnWidths: { [base.content.columns[0]!]: 120 },
      formatOverrides: {
        rows: { [base.content.rows[0]!]: { fontWeight: 'bold' as const } },
        columns: { [base.content.columns[0]!]: { fillColor: '#123456' as const } },
        cells: { [cellIdentityKey({ rowId: base.content.rows[1]!, columnId: base.content.columns[1]! })]: { fontWeight: 'bold' as const } },
      },
    },
  };
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
  const loaded = await api.loadSheet('s');
  const reloaded = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([loaded]), apiClient: api }));
  expect(reloaded.result.current.workbook.documents.s!.content).toEqual(persisted.content);
  expect(reloaded.result.current.workbook.documents.s!.content.cells).toEqual(sheet.content.cells);
  expect(reloaded.result.current.workbook.documents.s!.presentation).toEqual(sheet.presentation);
  expect(reloaded.result.current.workbook.documents.s!.columnNames).toEqual(sheet.columnNames);
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

it('retains model binding metadata when a bound sheet row order is saved and reloaded', async () => {
  const base = sheetDocument({ id: 's', name: 'Bound', rowCount: 2, columnCount: 2, cells: { A1: '9', B2: '=A1' } });
  const sheet = { ...base, modelId: 'model', modelColumnBindings: { amount: base.content.columns[0]! } };
  let persisted = sheet;
  const api = autosaveClient({
    loadSheet: vi.fn(async () => structuredClone(persisted)),
    writeAxisOrder: vi.fn(async (_id, _axis, order, revision) => {
      persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, rows: [...order] } };
      return structuredClone(persisted);
    }),
  });
  const mounted = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => expect(mounted.result.current.commands.shiftAxis('s', 'row', [sheet.content.rows[0]!], 1).status).toBe('changed'));
  await waitFor(() => expect(mounted.result.current.saveStatus).toBe('saved'));
  mounted.unmount();
  const loaded = await api.loadSheet('s');
  const reloaded = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([loaded]), apiClient: api }));
  expect(reloaded.result.current.workbook.documents.s).toEqual(persisted);
  expect(loaded.modelId).toBe('model');
  expect(loaded.modelColumnBindings).toEqual(sheet.modelColumnBindings);
  expect(loaded.content.cells).toEqual(sheet.content.cells);
  expect(loaded.content.rows).toEqual([...sheet.content.rows].reverse());
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

it('replays undo and redo immediately after a failed order save and persists them on retry', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 2, columnCount: 1 });
  const [a, b] = sheet.content.rows;
  let persisted = sheet;
  let fail = true;
  const api = autosaveClient({
    loadSheet: vi.fn(async () => structuredClone(persisted)),
    writeAxisOrder: vi.fn(async (_id, _axis, order, revision) => {
      if (fail) { fail = false; throw new Error('offline'); }
      expect(revision).toBe(persisted.revision);
      persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, rows: [...order] } };
      return structuredClone(persisted);
    }),
  });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => result.current.commands.shiftAxis('s', 'row', [a!], 1));
  await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
  expect(result.current.canRetryFailedSaves).toBe(true);
  act(() => result.current.commands.undo());
  expect(result.current.workbook.documents.s!.content.rows).toEqual([a, b]);
  expect(result.current.canRedo).toBe(true);
  act(() => result.current.commands.redo());
  expect(result.current.workbook.documents.s!.content.rows).toEqual([b, a]);
  expect(result.current.canUndo).toBe(true);
  act(() => result.current.commands.retryFailedSaves());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(persisted.content.rows).toEqual([b, a]);
  expect(persisted.revision).toBe(3);
});

it('reconciles an order revision without losing later cell, frame and order edits', async () => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 3, columnCount: 1 });
  const [a, b, c] = sheet.content.rows;
  const columnId = sheet.content.columns[0]!;
  const key = cellIdentityKey({ rowId: a!, columnId });
  const position = { x: 123, y: 456 };
  let persisted = sheet;
  const pending = deferred<void>();
  const api = autosaveClient({
    loadSheet: vi.fn(async () => structuredClone(persisted)),
    writeAxisOrder: vi.fn(async (_id, _axis, order, revision) => {
      if (revision === 0) await pending.promise;
      expect(revision).toBe(persisted.revision);
      persisted = { ...persisted, revision: revision + 1, content: { ...persisted.content, rows: [...order] } };
      return structuredClone(persisted);
    }),
    writeCells: vi.fn(async (revisions, cells) => {
      expect(revisions[0]!.revision).toBe(persisted.revision);
      persisted = { ...persisted, revision: persisted.revision + 1, content: { ...persisted.content, cells: { ...persisted.content.cells, [key]: cells[0]!.raw } } };
      return { sheets: [{ sheetId: 's', revision: persisted.revision }] };
    }),
    updateSheetPosition: vi.fn(async (_id, nextPosition, options) => {
      expect(options?.revision).toBe(persisted.revision);
      persisted = { ...persisted, revision: persisted.revision + 1, frame: { ...persisted.frame, position: nextPosition } };
      return { sheetId: 's', revision: persisted.revision };
    }),
  });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
  act(() => result.current.commands.shiftAxis('s', 'row', [a!], 1));
  await waitFor(() => expect(api.writeAxisOrder).toHaveBeenCalledTimes(1));
  act(() => {
    result.current.commands.writeCells([{ sheetId: 's', rowId: a!, columnId, raw: '42' }]);
    result.current.commands.moveSheetFrame('s', position);
    result.current.commands.shiftAxis('s', 'row', [a!], 1);
  });
  expect(result.current.workbook.documents.s!.content.rows).toEqual([b, c, a]);
  await act(async () => pending.resolve());
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(persisted.content.rows).toEqual([b, c, a]);
  expect(persisted.content.cells[key]).toBe('42');
  expect(persisted.frame.position).toEqual(position);
  expect(result.current.workbook.documents.s!.content).toEqual(persisted.content);
  expect(result.current.workbook.documents.s!.frame.position).toEqual(position);
  expect(result.current.workbook.documents.s!.revision).toBe(4);
});
