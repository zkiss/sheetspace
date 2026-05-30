import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from './test/apiClients';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';
import type { Workbook } from './workbook';
import { WorkbookApiError, type WorkbookApi } from './workbookApi';
import { useEditQueue } from './useEditQueue';

function renderQueue({
  apiClient = {},
  initialWorkbook = workbookWithSheets([]),
}: {
  apiClient?: Partial<WorkbookApi>;
  initialWorkbook?: Workbook;
} = {}) {
  return renderHook(() => {
    const [workbook, setWorkbook] = useState(initialWorkbook);
    return {
      queue: useEditQueue({
        autosaveEnabled: true,
        resolvedApiClient: apiClient,
        setWorkbook,
        workbook,
      }),
      workbook,
    };
  });
}

describe('useEditQueue', () => {
  it('cancels a pending sheet create before the request is sent', async () => {
    const createRun = vi.fn().mockResolvedValue(workbookWithSheets([]));
    const { result } = renderQueue();

    act(() => {
      result.current.queue.registerPendingSheet('pending:sheet-inputs');
      result.current.queue.enqueuePendingSheetCreate(
        'pending:sheet-inputs',
        createRun,
        () => 'sheet-inputs',
        vi.fn(),
      );
      result.current.queue.cancelPendingSheet('pending:sheet-inputs');
    });

    await waitFor(() => expect(result.current.queue.saveStatus).toBe('saved'));
    expect(createRun).not.toHaveBeenCalled();
  });

  it('runs one save per entity key and keeps only the latest queued replacement', async () => {
    const firstSave = deferred<Workbook>();
    const latestSave = deferred<Workbook>();
    const obsoleteRun = vi.fn().mockResolvedValue(workbookWithSheets([]));
    const firstRun = vi.fn().mockReturnValue(firstSave.promise);
    const latestRun = vi.fn().mockReturnValue(latestSave.promise);
    const { result } = renderQueue();

    act(() => {
      result.current.queue.enqueueEdit('cell:sheet-inputs:A1', firstRun);
      result.current.queue.enqueueEdit('cell:sheet-inputs:A1', obsoleteRun);
      result.current.queue.enqueueEdit('cell:sheet-inputs:A1', latestRun);
    });

    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(obsoleteRun).not.toHaveBeenCalled();
    expect(latestRun).not.toHaveBeenCalled();
    expect(result.current.queue.saveStatus).toBe('saving');

    await act(async () => {
      firstSave.resolve(workbookWithSheets([]));
      await firstSave.promise;
    });

    await waitFor(() => expect(latestRun).toHaveBeenCalledTimes(1));
    expect(obsoleteRun).not.toHaveBeenCalled();
    expect(result.current.queue.saveStatus).toBe('saving');

    await act(async () => {
      latestSave.resolve(workbookWithSheets([]));
      await latestSave.promise;
    });

    await waitFor(() => expect(result.current.queue.saveStatus).toBe('saved'));
  });

  it('keeps save status pending until all parallel entity-key saves finish', async () => {
    const firstSave = deferred<Workbook>();
    const secondSave = deferred<Workbook>();
    const firstRun = vi.fn().mockReturnValue(firstSave.promise);
    const secondRun = vi.fn().mockReturnValue(secondSave.promise);
    const { result } = renderQueue();

    act(() => {
      result.current.queue.enqueueEdit('cell:sheet-inputs:A1', firstRun);
      result.current.queue.enqueueEdit('cell:sheet-inputs:B1', secondRun);
    });

    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(secondRun).toHaveBeenCalledTimes(1);
    expect(result.current.queue.saveStatus).toBe('saving');

    await act(async () => {
      secondSave.resolve(workbookWithSheets([]));
      await secondSave.promise;
    });

    await waitFor(() => expect(result.current.queue.saveStatus).toBe('saving'));

    await act(async () => {
      firstSave.resolve(workbookWithSheets([]));
      await firstSave.promise;
    });

    await waitFor(() => expect(result.current.queue.saveStatus).toBe('saved'));
  });

  it('keeps failed status when an older parallel entity-key save fails after another key resolves', async () => {
    const firstSave = deferred<Workbook>();
    const secondSave = deferred<Workbook>();
    const { result } = renderQueue();

    act(() => {
      result.current.queue.enqueueEdit('cell:sheet-inputs:A1', () => firstSave.promise);
      result.current.queue.enqueueEdit('cell:sheet-inputs:B1', () => secondSave.promise);
    });

    await act(async () => {
      secondSave.resolve(workbookWithSheets([]));
      await secondSave.promise;
    });

    await waitFor(() => expect(result.current.queue.saveStatus).toBe('saving'));

    await act(async () => {
      firstSave.reject(new Error('backend unavailable'));
      await firstSave.promise.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.queue.saveStatus).toBe('failed'));
  });

  it('reports failed save status when a save rejects without a replacement queued', async () => {
    const failedSave = deferred<Workbook>();
    const { result } = renderQueue();

    act(() => {
      result.current.queue.enqueueEdit('cell:sheet-inputs:A1', () => failedSave.promise);
    });

    await act(async () => {
      failedSave.reject(new Error('backend unavailable'));
      await failedSave.promise.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.queue.saveStatus).toBe('failed'));
  });

  it('reloads the latest sheet revision and retries a conflicting revisioned save', async () => {
    const initialSheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 }), revision: 3 };
    const reloadedSheet = { ...initialSheet, revision: 7 };
    const savedSheet = { ...initialSheet, revision: 8 };
    const apiClient = {
      loadWorkbook: vi.fn().mockResolvedValue(workbookWithSheets([reloadedSheet])),
    };
    const save = vi
      .fn()
      .mockRejectedValueOnce(new WorkbookApiError('sheet-revision-conflict', 409, 'sheet-revision-conflict'))
      .mockResolvedValueOnce(workbookWithSheets([savedSheet]));
    const { result } = renderQueue({
      apiClient,
      initialWorkbook: workbookWithSheets([initialSheet]),
    });

    act(() => {
      result.current.queue.enqueueEdit('sheet:sheet-inputs:name', () =>
        result.current.queue.runRevisionedEdit('sheet-inputs', save),
      );
    });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenNthCalledWith(1, 3);
    expect(apiClient.loadWorkbook).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(2, 7);
    await waitFor(() => expect(result.current.workbook.sheets[0].revision).toBe(8));
  });
});
