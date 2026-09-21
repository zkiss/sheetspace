import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useGridAxisCreationOperations } from './useGridAxisCreationOperations';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { WorkbookApiError, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';

function renderAxisOperations({
  autosaveEnabled = true,
  apiClient = {},
}: {
  autosaveEnabled?: boolean;
  apiClient?: Partial<WorkbookApi>;
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
      resolvedApiClient: { ...apiClient, appendRow },
      setWorkbook,
    });
  });
  return { appendRow, coordinator, hook, reconcile, sheet };
}

describe('useGridAxisCreationOperations', () => {
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
});
