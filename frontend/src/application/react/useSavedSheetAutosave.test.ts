import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@test-support/apiClients';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';
import { findSheetById } from '@workbook/read/queries';
import { type Workbook } from '@workbook/core/model';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import { WorkbookApiError, type SheetRevisionResponse, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import { useSavedSheetAutosave } from './useSavedSheetAutosave';

function renderAutosave(apiClient: Partial<WorkbookApi>, initialWorkbook: Workbook) {
  return renderHook(() => {
    const [workbook, setWorkbook] = useState(initialWorkbook);
    const updateWorkbook = useCallback<SetWorkbook>((update) => setWorkbook(update), []);
    return {
      autosave: useSavedSheetAutosave({
        autosaveEnabled: true,
        resolvedApiClient: apiClient,
        setWorkbook: updateWorkbook,
        workbook,
      }),
      workbook,
    };
  });
}

describe('useSavedSheetAutosave', () => {
  it('derives save status from outbox snapshots and records successful revisions', async () => {
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const save = deferred<SheetRevisionResponse>();
    const apiClient = { renameSheet: vi.fn().mockReturnValue(save.promise) };
    const { result } = renderAutosave(apiClient, workbookWithSheets([sheet]));

    act(() => result.current.autosave.enqueue('rename-1', {
      kind: 'rename-sheet', sheetId: sheet.id, name: 'Renamed',
    }));
    expect(result.current.autosave.saveStatus).toBe('saving');

    save.resolve({ sheetId: sheet.id, revision: 2 });
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saved'));
    expect(findSheetById(result.current.workbook, sheet.id)?.revision).toBe(2);
  });

  it('retains an inspectable failure and retries the same operation payload without local application', async () => {
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const retry = deferred<SheetRevisionResponse>();
    const renameSheet = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(retry.promise);
    const { result } = renderAutosave({ renameSheet }, workbookWithSheets([sheet]));

    act(() => result.current.autosave.enqueue('rename-identity', {
      kind: 'rename-sheet', sheetId: sheet.id, name: 'Retained payload',
    }));
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('failed'));
    expect(result.current.autosave.outboxSnapshot[0]).toMatchObject({
      operationId: 'rename-identity',
      intent: { kind: 'rename-sheet', sheetId: sheet.id, name: 'Retained payload' },
      status: 'failed',
      failure: expect.any(Error),
    });

    act(() => result.current.autosave.retryFailedSaves());
    expect(result.current.autosave.saveStatus).toBe('saving');
    expect(renameSheet).toHaveBeenNthCalledWith(2, sheet.id, 'Retained payload', { revision: 0 });
    retry.resolve({ sheetId: sheet.id, revision: 1 });
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saved'));
    expect(result.current.autosave.outboxSnapshot[0]).toMatchObject({
      operationId: 'rename-identity', status: 'succeeded', failure: undefined,
    });
  });

  it('does not enqueue persistence while autosave is disabled', () => {
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const apiClient = { renameSheet: vi.fn() };
    const { result } = renderHook(() => {
      const [workbook, setWorkbook] = useState(workbookWithSheets([sheet]));
      return useSavedSheetAutosave({
        autosaveEnabled: false,
        resolvedApiClient: apiClient,
        setWorkbook: (update) => setWorkbook(update),
        workbook,
      });
    });

    act(() => result.current.enqueue('rename-1', {
      kind: 'rename-sheet', sheetId: sheet.id, name: 'Local only',
    }));
    expect(result.current.outboxSnapshot).toEqual([]);
    expect(apiClient.renameSheet).not.toHaveBeenCalled();
  });

  it('persists a moved survivor before removing a different missing z-order member', async () => {
    const missing = positionedSheet('sheet-missing', 'Missing', { x: 0, y: 0 });
    const crossed = positionedSheet('sheet-crossed', 'Crossed', { x: 300, y: 0 });
    const moved = positionedSheet('sheet-moved', 'Moved', { x: 600, y: 0 });
    const survivorSave = deferred<{ sheets: Array<{ sheetId: string; revision: number }> }>();
    const updateSheetZOrder = vi.fn()
      .mockRejectedValueOnce(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'))
      .mockReturnValueOnce(survivorSave.promise);
    const apiClient: Partial<WorkbookApi> = {
      loadSheet: vi.fn().mockImplementation(async (sheetId: string) => {
        if (sheetId === missing.id) {
          throw new WorkbookApiError('missing', 404, 'sheet-not-found');
        }
        return { ...(sheetId === crossed.id ? crossed : moved), revision: sheetId === crossed.id ? 7 : 8 };
      }),
      updateSheetZOrder,
    };
    const { result } = renderAutosave(apiClient, workbookWithSheets([missing, crossed, moved]));

    act(() => {
      result.current.autosave.enqueue('z-order', {
        kind: 'update-sheet-z-order',
        updates: [
          { sheetId: missing.id, zIndex: 3 },
          { sheetId: crossed.id, zIndex: 1 },
          { sheetId: moved.id, zIndex: 2 },
        ],
      });
      result.current.autosave.enqueue('missing-rename', {
        kind: 'rename-sheet', sheetId: missing.id, name: 'Never sent',
      });
    });

    await waitFor(() => expect(updateSheetZOrder).toHaveBeenCalledTimes(2));
    expect(updateSheetZOrder).toHaveBeenNthCalledWith(2, [
      { sheetId: crossed.id, expectedRevision: 7, zIndex: 1 },
      { sheetId: moved.id, expectedRevision: 8, zIndex: 2 },
    ]);
    expect(result.current.autosave.saveStatus).toBe('saving');
    expect(result.current.workbook.manifest.sheetIds).toContain(missing.id);

    survivorSave.resolve({
      sheets: [
        { sheetId: crossed.id, revision: 9 },
        { sheetId: moved.id, revision: 10 },
      ],
    });
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saved'));
    expect(result.current.workbook.manifest.sheetIds).toEqual([crossed.id, moved.id]);
    expect(findSheetById(result.current.workbook, crossed.id)?.revision).toBe(9);
    expect(findSheetById(result.current.workbook, moved.id)?.revision).toBe(10);
    expect(result.current.autosave.outboxSnapshot).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: 'missing-rename', status: 'superseded' }),
      expect.objectContaining({ operationId: 'z-order', status: 'succeeded' }),
    ]));
  });
});
