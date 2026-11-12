import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useGridAxisCreationOperations } from './useGridAxisCreationOperations';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { WorkbookApiError, workbookApi, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';
import { deferred } from '@test-support/apiClients';

function renderAxisOperations({
  autosaveEnabled = true,
  apiClient = {},
  useDefaultApi = false,
  bound = false,
}: {
  autosaveEnabled?: boolean;
  apiClient?: Partial<WorkbookApi>;
  useDefaultApi?: boolean;
  bound?: boolean;
} = {}) {
  const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }), revision: 3, ...(bound ? { modelId: 'model' } : {}) };
  const coordinator = new WorkbookPersistenceCoordinator();
  const appendRow = apiClient.appendRow ?? vi.fn().mockResolvedValue({ sheetId: sheet.id, revision: 4, rowCount: 21, rowId: 'server-row' });
  const reconcile = vi.fn();
  const hook = renderHook(() => {
    const [workbook, setWorkbookState] = useState(() => workbookWithSheets([sheet]));
    const workbookRef = useRef(workbook);
    workbookRef.current = workbook;
    const setWorkbook = useCallback<SetWorkbook>((update) => {
      setWorkbookState((current) => typeof update === 'function' ? update(current) : update);
    }, []);
    return useGridAxisCreationOperations({
      autosaveEnabled,
      currentWorkbook: () => workbookRef.current,
      persistenceCoordinator: coordinator,
      reconcile,
      resolvedApiClient: useDefaultApi ? apiClient : { ...apiClient, appendRow },
      setWorkbook,
    });
  });
  return { appendRow, coordinator, hook, reconcile, sheet };
}

describe('useGridAxisCreationOperations', () => {
  it('does not create rows or columns on a bound sheet', () => {
    const appendColumn = vi.fn();
    const { appendRow, hook, sheet } = renderAxisOperations({ bound: true, apiClient: { appendColumn } });

    act(() => {
      hook.result.current.appendRow(sheet.id);
      hook.result.current.appendColumn(sheet.id);
    });

    expect(appendRow).not.toHaveBeenCalled();
    expect(appendColumn).not.toHaveBeenCalled();
    expect(hook.result.current.creatingAxes).toEqual({});
  });
  it('uses the default row and column APIs when callers do not override them', async () => {
    const appendRow = vi.spyOn(workbookApi, 'appendRow')
      .mockResolvedValue({ sheetId: 'sheet-inputs', revision: 4, rowCount: 21, rowId: 'default-row' });
    const appendColumn = vi.spyOn(workbookApi, 'appendColumn')
      .mockResolvedValue({ sheetId: 'sheet-inputs', revision: 5, columnCount: 11, columnId: 'default-column' });
    const { hook, reconcile, sheet } = renderAxisOperations({ useDefaultApi: true });

    act(() => hook.result.current.appendRow(sheet.id));
    await waitFor(() => expect(appendRow).toHaveBeenCalledWith(sheet.id, { revision: 3 }));
    act(() => hook.result.current.appendColumn(sheet.id));
    await waitFor(() => expect(appendColumn).toHaveBeenCalledWith(sheet.id, { revision: 4 }));

    expect(reconcile).toHaveBeenCalledWith({ kind: 'append-row', sheetId: sheet.id, rowId: 'default-row' });
    expect(reconcile).toHaveBeenCalledWith({ kind: 'append-column', sheetId: sheet.id, columnId: 'default-column' });
    appendRow.mockRestore();
    appendColumn.mockRestore();
  });

  it('does not create an axis while autosave is disabled or for an unknown sheet', () => {
    const offline = renderAxisOperations({ autosaveEnabled: false });
    const online = renderAxisOperations();

    act(() => {
      offline.hook.result.current.appendRow(offline.sheet.id);
      online.hook.result.current.appendRow('missing-sheet');
    });

    expect(offline.hook.result.current.creatingAxes).toEqual({});
    expect(offline.appendRow).not.toHaveBeenCalled();
    expect(online.hook.result.current.creatingAxes).toEqual({});
    expect(online.appendRow).not.toHaveBeenCalled();
  });

  it('reconciles a successful append and removes its creating slot', async () => {
    const { appendRow, hook, reconcile, sheet } = renderAxisOperations();

    act(() => hook.result.current.appendRow(sheet.id));

    await waitFor(() => expect(appendRow).toHaveBeenCalledWith(sheet.id, { revision: 3 }));
    await waitFor(() => expect(hook.result.current.creatingAxes[sheet.id]).toBeUndefined());
    expect(reconcile).toHaveBeenCalledWith({ kind: 'append-row', sheetId: sheet.id, rowId: 'server-row' });
    expect(hook.result.current.saveStatus).toBe('saved');
  });

  it('uses the column operation and reconciles its server axis id', async () => {
    const appendColumn = vi.fn().mockResolvedValue({ sheetId: 'sheet-inputs', revision: 4, columnCount: 11, columnId: 'server-column' });
    const { hook, reconcile, sheet } = renderAxisOperations({ apiClient: { appendColumn } });

    act(() => hook.result.current.appendColumn(sheet.id));

    await waitFor(() => expect(appendColumn).toHaveBeenCalledWith(sheet.id, { revision: 3 }));
    await waitFor(() => expect(hook.result.current.saveStatus).toBe('saved'));
    expect(reconcile).toHaveBeenCalledWith({ kind: 'append-column', sheetId: sheet.id, columnId: 'server-column' });
  });

  it('suppresses queued and future appends while a sheet deletion is prepared', async () => {
    let resolveAppend!: (value: { sheetId: string; revision: number; rowCount: number; rowId: string }) => void;
    const appendRow = vi.fn(() => new Promise<typeof resolveAppend extends (value: infer T) => void ? T : never>((resolve) => { resolveAppend = resolve; }));
    const { hook, sheet } = renderAxisOperations({ apiClient: { appendRow } });

    act(() => hook.result.current.appendRow(sheet.id));
    await waitFor(() => expect(appendRow).toHaveBeenCalledOnce());
    let deletion: Promise<void> | undefined;
    act(() => { deletion = hook.result.current.prepareSheetDeletion(sheet.id); });
    act(() => resolveAppend({ sheetId: sheet.id, revision: 4, rowCount: 21, rowId: 'server-row' }));
    await deletion;
    act(() => hook.result.current.appendRow(sheet.id));

    expect(appendRow).toHaveBeenCalledOnce();
    await waitFor(() => expect(hook.result.current.saveStatus).toBe('saved'));
  });

  it('supersedes a failed append when a later append for the same sheet succeeds', async () => {
    const appendRow = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ sheetId: 'sheet-inputs', revision: 4, rowCount: 21, rowId: 'server-row' });
    const { hook, sheet } = renderAxisOperations({ apiClient: { appendRow } });

    act(() => hook.result.current.appendRow(sheet.id));
    await waitFor(() => expect(hook.result.current.saveStatus).toBe('failed'));
    act(() => hook.result.current.appendRow(sheet.id));
    await waitFor(() => expect(appendRow).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.saveStatus).toBe('saved'));
  });

  it.each(['succeeds', 'fails'] as const)('retires a failed row while its already-queued column %s', async (outcome) => {
    const row = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
    const column = deferred<{ sheetId: string; revision: number; columnCount: number; columnId: string }>();
    const appendRow = vi.fn(() => row.promise);
    const appendColumn = vi.fn(() => column.promise);
    const { hook, sheet, reconcile } = renderAxisOperations({ apiClient: { appendRow, appendColumn } });
    act(() => { hook.result.current.appendRow(sheet.id); hook.result.current.appendColumn(sheet.id); });
    await waitFor(() => expect(appendRow).toHaveBeenCalledOnce());
    expect(appendColumn).not.toHaveBeenCalled();
    expect(hook.result.current.creatingAxes[sheet.id]?.rows).toHaveLength(1);
    expect(hook.result.current.creatingAxes[sheet.id]?.columns).toHaveLength(1);
    await act(async () => row.reject(new Error('first failed')));
    await waitFor(() => expect(appendColumn).toHaveBeenCalledOnce());
    expect(hook.result.current.saveStatus).toBe('saving');
    expect(hook.result.current.hasUnsettled()).toBe(true);
    expect(hook.result.current.hasUnsettledSheet(sheet.id)).toBe(true);
    expect(hook.result.current.hasUnsettledSheet('other')).toBe(false);
    expect(hook.result.current.creatingAxes[sheet.id]?.rows).toHaveLength(0);
    expect(hook.result.current.creatingAxes[sheet.id]?.columns).toHaveLength(1);
    if (outcome === 'fails') {
      await act(async () => column.reject(new Error('second failed')));
      await waitFor(() => expect(hook.result.current.saveStatus).toBe('failed'));
      expect(hook.result.current.hasUnsettledSheet(sheet.id)).toBe(true);
      expect(reconcile).not.toHaveBeenCalled();
    } else {
      await act(async () => column.resolve({ sheetId: sheet.id, revision: 4, columnCount: 11, columnId: 'new-column' }));
      await waitFor(() => expect(hook.result.current.saveStatus).toBe('saved'));
      expect(hook.result.current.hasUnsettled()).toBe(false);
      expect(hook.result.current.hasUnsettledSheet(sheet.id)).toBe(false);
      expect(reconcile).toHaveBeenCalledOnce();
      expect(reconcile).toHaveBeenCalledWith({ kind: 'append-column', sheetId: sheet.id, columnId: 'new-column' });
    }
    expect(hook.result.current.creatingAxes[sheet.id]).toBeUndefined();
    expect(appendRow).toHaveBeenCalledOnce();
    expect(appendColumn).toHaveBeenCalledOnce();
  });

  it('does not issue a queued request after its sheet becomes missing', async () => {
    let release!: () => void;
    const appendRow = vi.fn();
    const { coordinator, hook, sheet } = renderAxisOperations({ apiClient: { appendRow } });
    const predecessor = coordinator.serialize([sheet.id], () => new Promise<void>((resolve) => { release = resolve; }));

    act(() => hook.result.current.appendRow(sheet.id));
    act(() => coordinator.confirmSheetMissing(sheet.id));
    release();
    await predecessor;
    await waitFor(() => expect(hook.result.current.saveStatus).toBe('saved'));

    expect(appendRow).not.toHaveBeenCalled();
  });

  it('cancels a conflict retry when reloading confirms the sheet is missing', async () => {
    const appendRow = vi.fn().mockRejectedValue(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'));
    const loadSheet = vi.fn().mockRejectedValue(new WorkbookApiError('missing', 404, 'sheet-not-found'));
    const { coordinator, hook, sheet } = renderAxisOperations({ apiClient: { appendRow, loadSheet } });

    act(() => hook.result.current.appendRow(sheet.id));

    await waitFor(() => expect(loadSheet).toHaveBeenCalledWith(sheet.id));
    await waitFor(() => expect(hook.result.current.creatingAxes[sheet.id]).toBeUndefined());
    expect(appendRow).toHaveBeenCalledTimes(1);
    expect(coordinator.isSheetMissing(sheet.id)).toBe(true);
    expect(hook.result.current.saveStatus).toBe('saved');
  });

  it('propagates a non-missing reload failure after a revision conflict', async () => {
    const appendRow = vi.fn().mockRejectedValue(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'));
    const loadSheet = vi.fn().mockRejectedValue(new WorkbookApiError('unavailable', 503, 'service-unavailable'));
    const { hook, sheet } = renderAxisOperations({ apiClient: { appendRow, loadSheet } });

    act(() => hook.result.current.appendRow(sheet.id));

    await waitFor(() => expect(loadSheet).toHaveBeenCalledWith(sheet.id));
    await waitFor(() => expect(hook.result.current.saveStatus).toBe('failed'));
    expect(appendRow).toHaveBeenCalledOnce();
  });
});

it('holds workbook-wide ownership until the earlier backend append reconciles', async () => {
  const a = positionedSheet('a', 'A', { x: 0, y: 0 });
  const b = positionedSheet('b', 'B', { x: 0, y: 0 });
  const workbook = workbookWithSheets([a, b]);
  const first = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
  const appendRow = vi.fn().mockReturnValue(first.promise);
  const createSorted = vi.fn(({ sheetId }: { sheetId: string }) => sheetId === 'b');
  const reconcile = vi.fn();
  const coordinator = new WorkbookPersistenceCoordinator();
  const { result } = renderHook(() => useGridAxisCreationOperations({ autosaveEnabled: true, currentWorkbook: () => workbook, persistenceCoordinator: coordinator, reconcile, createSorted, resolvedApiClient: { appendRow }, setWorkbook: () => {} }));
  act(() => { result.current.appendRow('a'); result.current.appendRow('b'); });
  expect(appendRow).toHaveBeenCalledTimes(1);
  expect(createSorted).toHaveBeenCalledTimes(1);
  expect(result.current.creatingAxes.b?.rows).toHaveLength(1);
  await act(async () => { first.resolve({ sheetId: 'a', revision: 1, rowCount: 21, rowId: 'first' }); });
  await waitFor(() => expect(createSorted).toHaveBeenCalledTimes(2));
  expect(reconcile).toHaveBeenCalledWith({ kind: 'append-row', sheetId: 'a', rowId: 'first' });
  expect(appendRow).toHaveBeenCalledTimes(1);
});

it('retains physical ownership after missing confirmation and rejects stale owner tokens', async () => {
  const a = positionedSheet('a', 'A', { x: 0, y: 0 });
  const b = positionedSheet('b', 'B', { x: 0, y: 0 });
  const workbook = workbookWithSheets([a, b]);
  const first = deferred<{ sheetId: string; revision: number; rowCount: number; rowId: string }>();
  const appendRow = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ sheetId: 'b', revision: 1, rowCount: 21, rowId: 'b-row' });
  const coordinator = new WorkbookPersistenceCoordinator();
  const { result } = renderHook(() => useGridAxisCreationOperations({ autosaveEnabled: true, currentWorkbook: () => workbook, persistenceCoordinator: coordinator, reconcile: vi.fn(), resolvedApiClient: { appendRow }, setWorkbook: () => {} }));
  act(() => result.current.appendRow('a'));
  const owner = result.current.creatingAxes.a!.rows[0]!.operationId;
  expect(result.current.admitsOwner(owner)).toBe(true);
  expect(result.current.admitsOwner('unknown')).toBe(false);
  act(() => { coordinator.confirmSheetMissing('a'); result.current.appendRow('b'); });
  expect(result.current.admitsOwner(owner)).toBe(false);
  expect(appendRow).toHaveBeenCalledTimes(1);
  expect(result.current.creatingAxes.b?.rows).toHaveLength(1);
  await act(async () => first.resolve({ sheetId: 'a', revision: 1, rowCount: 21, rowId: 'a-row' }));
  await waitFor(() => expect(appendRow).toHaveBeenCalledTimes(2));
  expect(result.current.admitsOwner(owner)).toBe(false);
});

it.each(['deletion', 'missing'] as const)('does not dispatch an owner waiting when its sheet has %s', async (reason) => {
  const wait = deferred<void>();
  const sheet = positionedSheet('a', 'A', { x: 0, y: 0 });
  const workbook = workbookWithSheets([sheet]);
  const coordinator = new WorkbookPersistenceCoordinator();
  const appendRow = vi.fn();
  const createSorted = vi.fn();
  const { result } = renderHook(() => useGridAxisCreationOperations({ autosaveEnabled: true, beforeCreate: () => wait.promise, currentWorkbook: () => workbook, persistenceCoordinator: coordinator, reconcile: vi.fn(), createSorted, resolvedApiClient: { appendRow }, setWorkbook: () => {} }));
  act(() => result.current.appendRow('a'));
  let deletion: Promise<void> | undefined;
  act(() => { if (reason === 'deletion') deletion = result.current.prepareSheetDeletion('a'); else coordinator.confirmSheetMissing('a'); });
  await act(async () => { wait.resolve(); await deletion; });
  await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  expect(createSorted).not.toHaveBeenCalled();
  expect(appendRow).not.toHaveBeenCalled();
});

it('rejects queued aggregate owners while a foreign failure remains unresolved', async () => {
  const a = positionedSheet('a', 'A', { x: 0, y: 0 });
  const b = positionedSheet('b', 'B', { x: 0, y: 0 });
  const workbook = workbookWithSheets([a, b]);
  const first = deferred<boolean>();
  const admissions: Array<[string, boolean]> = [];
  const coordinator = new WorkbookPersistenceCoordinator();
  let admitsOwner: (id: string) => boolean = () => false;
  const createSorted = vi.fn(({ operationId, sheetId }: { operationId: string; sheetId: string }) => {
    const admitted = admitsOwner(operationId);
    admissions.push([sheetId, admitted]);
    if (admissions.length === 1) return first.promise;
    if (!admitted) throw new Error('pending-axis-creation');
    return true;
  });
  const { result } = renderHook(() => useGridAxisCreationOperations({ autosaveEnabled: true, currentWorkbook: () => workbook, persistenceCoordinator: coordinator, reconcile: vi.fn(), createSorted, resolvedApiClient: {}, setWorkbook: () => {} }));
  admitsOwner = (id) => result.current.admitsOwner(id);
  act(() => { result.current.appendRow('a'); result.current.appendRow('b'); result.current.appendColumn('b'); });
  await act(async () => first.reject(new Error('definite failure')));
  await waitFor(() => expect(createSorted).toHaveBeenCalledTimes(3));
  expect(admissions).toEqual([['a', true], ['b', false], ['b', false]]);
  expect(result.current.hasUnsettledSheet('a')).toBe(true);
  expect(result.current.hasUnsettledSheet('b')).toBe(true);
});
