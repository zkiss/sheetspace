import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useGridAxisCreationOperations } from './useGridAxisCreationOperations';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { WorkbookApiError, workbookApi, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

function renderAxisOperations({
  autosaveEnabled = true,
  apiClient = {},
  useDefaultApi = false,
}: {
  autosaveEnabled?: boolean;
  apiClient?: Partial<WorkbookApi>;
  useDefaultApi?: boolean;
} = {}) {
  const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 10, y: 20 }), revision: 3 };
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
