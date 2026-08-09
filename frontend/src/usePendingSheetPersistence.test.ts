import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from './test/apiClients';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';
import type { Workbook } from './workbook';
import type { WorkbookApi } from './workbookApi';
import { usePendingSheetPersistence } from './usePendingSheetPersistence';

function renderPersistence({
  apiClient = {},
  initialWorkbook = workbookWithSheets([]),
}: {
  apiClient?: Partial<WorkbookApi>;
  initialWorkbook?: Workbook;
} = {}) {
  return renderHook(() => {
    const [workbook, setWorkbook] = useState(initialWorkbook);
    const updateWorkbook = useCallback(
      (update: Parameters<typeof setWorkbook>[0]) => setWorkbook(update),
      [],
    );
    return usePendingSheetPersistence({
      autosaveEnabled: true,
      resolvedApiClient: apiClient,
      setWorkbook: updateWorkbook,
      workbook,
    });
  });
}

describe('usePendingSheetPersistence', () => {
  it('cancels a pending sheet create before the request is sent', async () => {
    const savedSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const createRun = vi.fn().mockResolvedValue(savedSheet);
    const { result } = renderPersistence();

    act(() => {
      result.current.registerPendingSheet('pending:sheet-inputs');
      result.current.enqueuePendingSheetCreate(
        'pending:sheet-inputs',
        'Inputs',
        createRun,
        vi.fn(),
        vi.fn(),
      );
      result.current.cancelPendingSheet('pending:sheet-inputs');
    });

    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(createRun).not.toHaveBeenCalled();
  });

  it('rekeys pending sheet queues so post-create edits replace older queued work', async () => {
    const createSave = deferred<ReturnType<typeof positionedSheet>>();
    const firstCellSave = deferred<{ sheetId: string; revision: number }>();
    const latestCellSave = deferred<{ sheetId: string; revision: number }>();
    const savedSheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const firstCellRun = vi.fn().mockReturnValue(firstCellSave.promise);
    const latestCellRun = vi.fn().mockReturnValue(latestCellSave.promise);
    const { result } = renderPersistence();

    act(() => {
      result.current.registerPendingSheet('pending:sheet-inputs');
      result.current.enqueuePendingSheetCreate(
        'pending:sheet-inputs',
        'Inputs',
        () => createSave.promise,
        vi.fn(),
        vi.fn(),
      );
      result.current.enqueueRevisionedEdit({
        sheetId: 'pending:sheet-inputs',
        target: { kind: 'cell-content', cellKey: 'A1' },
        request: () => firstCellRun(),
      });
    });

    await act(async () => {
      createSave.resolve(savedSheet);
      await createSave.promise;
    });
    await waitFor(() => expect(firstCellRun).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.enqueueRevisionedEdit({
        sheetId: 'sheet-inputs',
        target: { kind: 'cell-content', cellKey: 'A1' },
        request: () => latestCellRun(),
      });
    });

    expect(latestCellRun).not.toHaveBeenCalled();
    await act(async () => {
      firstCellSave.resolve({ sheetId: savedSheet.id, revision: 1 });
      await firstCellSave.promise;
    });
    await waitFor(() => expect(latestCellRun).toHaveBeenCalledTimes(1));
    latestCellSave.resolve({ sheetId: savedSheet.id, revision: 2 });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });
});
