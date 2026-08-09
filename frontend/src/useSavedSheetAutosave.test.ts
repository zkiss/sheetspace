import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from './test/apiClients';
import { positionedSheet, workbookWithSheets } from './test/workbookFactories';
import { sheetsInOrder, type Workbook } from './workbook';
import type { SetWorkbook } from './workbookCalculation';
import { WorkbookApiError, type SheetRevisionResponse, type WorkbookApi } from './workbookApi';
import { useSavedSheetAutosave, type SavedSheetSaveTarget } from './useSavedSheetAutosave';

const renameTarget = { kind: 'rename' } as const;

function renderAutosave({
  apiClient = {},
  initialWorkbook = workbookWithSheets([]),
}: {
  apiClient?: Partial<WorkbookApi>;
  initialWorkbook?: Workbook;
} = {}) {
  return renderHook(() => {
    const [workbook, setWorkbook] = useState(initialWorkbook);
    const updateWorkbook = useCallback<SetWorkbook>((update) => {
      setWorkbook(update);
    }, []);
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

function enqueueRevisioned(
  autosave: ReturnType<typeof useSavedSheetAutosave>,
  {
    sheetId = 'sheet-inputs',
    target = renameTarget,
    run,
  }: {
    sheetId?: string;
    target?: SavedSheetSaveTarget;
    run: () => Promise<SheetRevisionResponse>;
  },
) {
  autosave.enqueueEdit({
    sheetId,
    target,
    run,
    reconcile: autosave.recordSheetRevision,
  });
}

describe('useSavedSheetAutosave', () => {
  it('records a successful save and returns to saved status', async () => {
    const sheet = positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 });
    const save = deferred<SheetRevisionResponse>();
    const { result } = renderAutosave({ initialWorkbook: workbookWithSheets([sheet]) });

    act(() => enqueueRevisioned(result.current.autosave, { run: () => save.promise }));
    expect(result.current.autosave.saveStatus).toBe('saving');

    await act(async () => {
      save.resolve({ sheetId: sheet.id, revision: 2 });
      await save.promise;
    });

    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saved'));
    expect(sheetsInOrder(result.current.workbook)[0].revision).toBe(2);
  });

  it('orders one target and coalesces queued work to its latest replacement', async () => {
    const first = deferred<SheetRevisionResponse>();
    const latest = deferred<SheetRevisionResponse>();
    const firstRun = vi.fn().mockReturnValue(first.promise);
    const obsoleteRun = vi.fn().mockResolvedValue({ sheetId: 'sheet-inputs', revision: 2 });
    const latestRun = vi.fn().mockReturnValue(latest.promise);
    const { result } = renderAutosave();

    act(() => {
      enqueueRevisioned(result.current.autosave, { run: firstRun });
      enqueueRevisioned(result.current.autosave, { run: obsoleteRun });
      enqueueRevisioned(result.current.autosave, { run: latestRun });
    });

    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(obsoleteRun).not.toHaveBeenCalled();
    expect(latestRun).not.toHaveBeenCalled();

    await act(async () => {
      first.resolve({ sheetId: 'sheet-inputs', revision: 1 });
      await first.promise;
    });
    await waitFor(() => expect(latestRun).toHaveBeenCalledTimes(1));
    expect(obsoleteRun).not.toHaveBeenCalled();

    latest.resolve({ sheetId: 'sheet-inputs', revision: 2 });
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saved'));
  });

  it('does not report failure when a failed running save has a queued replacement', async () => {
    const first = deferred<SheetRevisionResponse>();
    const latest = deferred<SheetRevisionResponse>();
    const latestRun = vi.fn().mockReturnValue(latest.promise);
    const { result } = renderAutosave();

    act(() => {
      enqueueRevisioned(result.current.autosave, { run: () => first.promise });
      enqueueRevisioned(result.current.autosave, { run: latestRun });
    });
    await act(async () => {
      first.reject(new Error('obsolete save failed'));
      await first.promise.catch(() => undefined);
    });

    await waitFor(() => expect(latestRun).toHaveBeenCalledTimes(1));
    expect(result.current.autosave.saveStatus).toBe('saving');
    latest.resolve({ sheetId: 'sheet-inputs', revision: 2 });
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saved'));
  });

  it('reports standalone failure and clears that target failure when retried', async () => {
    const failed = deferred<SheetRevisionResponse>();
    const retry = deferred<SheetRevisionResponse>();
    const { result } = renderAutosave();

    act(() => enqueueRevisioned(result.current.autosave, { run: () => failed.promise }));
    await act(async () => {
      failed.reject(new Error('backend unavailable'));
      await failed.promise.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('failed'));

    act(() => enqueueRevisioned(result.current.autosave, { run: () => retry.promise }));
    expect(result.current.autosave.saveStatus).toBe('saving');
    retry.resolve({ sheetId: 'sheet-inputs', revision: 1 });
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saved'));
  });

  it('keeps distinct targets parallel and saving until both finish', async () => {
    const cellSave = deferred<SheetRevisionResponse>();
    const positionSave = deferred<SheetRevisionResponse>();
    const cellRun = vi.fn().mockReturnValue(cellSave.promise);
    const positionRun = vi.fn().mockReturnValue(positionSave.promise);
    const { result } = renderAutosave();

    act(() => {
      enqueueRevisioned(result.current.autosave, {
        target: { kind: 'cell-content', cellKey: 'A1' },
        run: cellRun,
      });
      enqueueRevisioned(result.current.autosave, { target: { kind: 'position' }, run: positionRun });
    });
    expect(cellRun).toHaveBeenCalledTimes(1);
    expect(positionRun).toHaveBeenCalledTimes(1);

    positionSave.resolve({ sheetId: 'sheet-inputs', revision: 1 });
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saving'));
    cellSave.resolve({ sheetId: 'sheet-inputs', revision: 2 });
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saved'));
  });

  it.each(['failure-first', 'success-first'] as const)(
    'keeps a parallel target failure sticky when tasks settle %s',
    async (settlementOrder) => {
      const failedSave = deferred<SheetRevisionResponse>();
      const successfulSave = deferred<SheetRevisionResponse>();
      const { result } = renderAutosave();

      act(() => {
        enqueueRevisioned(result.current.autosave, {
          target: { kind: 'cell-content', cellKey: 'A1' },
          run: () => failedSave.promise,
        });
        enqueueRevisioned(result.current.autosave, {
          target: { kind: 'position' },
          run: () => successfulSave.promise,
        });
      });

      if (settlementOrder === 'failure-first') {
        await act(async () => {
          failedSave.reject(new Error('backend unavailable'));
          await failedSave.promise.catch(() => undefined);
        });
        await waitFor(() => expect(result.current.autosave.saveStatus).toBe('failed'));
        await act(async () => {
          successfulSave.resolve({ sheetId: 'sheet-inputs', revision: 1 });
          await successfulSave.promise;
        });
      } else {
        await act(async () => {
          successfulSave.resolve({ sheetId: 'sheet-inputs', revision: 1 });
          await successfulSave.promise;
        });
        await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saving'));
        await act(async () => {
          failedSave.reject(new Error('backend unavailable'));
          await failedSave.promise.catch(() => undefined);
        });
      }

      await waitFor(() => expect(result.current.autosave.saveStatus).toBe('failed'));
    },
  );

  it('reloads only the conflicting sheet and retries with its latest revision', async () => {
    const inputs = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 }), revision: 3 };
    const outputs = { ...positionedSheet('sheet-outputs', 'Outputs', { x: 300, y: 0 }), revision: 5 };
    const reloadedInputs = { ...inputs, revision: 7 };
    const loadSheet = vi.fn().mockResolvedValue(reloadedInputs);
    const inputRequest = vi.fn()
      .mockRejectedValueOnce(new WorkbookApiError('sheet-revision-conflict', 409, 'sheet-revision-conflict'))
      .mockResolvedValueOnce({ sheetId: inputs.id, revision: 8 });
    const outputRequest = vi.fn().mockResolvedValue({ sheetId: outputs.id, revision: 6 });
    const { result } = renderAutosave({
      apiClient: { loadSheet },
      initialWorkbook: workbookWithSheets([inputs, outputs]),
    });

    let inputSave!: Promise<SheetRevisionResponse | undefined>;
    let outputSave!: Promise<SheetRevisionResponse | undefined>;
    act(() => {
      inputSave = result.current.autosave.runRevisionedEdit({
        sheetId: inputs.id,
        request: inputRequest,
        revisionOf: (response) => response.revision,
      });
      outputSave = result.current.autosave.runRevisionedEdit({
        sheetId: outputs.id,
        request: outputRequest,
        revisionOf: (response) => response.revision,
      });
    });
    await act(async () => Promise.all([inputSave, outputSave]));

    expect(inputRequest).toHaveBeenNthCalledWith(1, 3);
    expect(inputRequest).toHaveBeenNthCalledWith(2, 7);
    expect(outputRequest).toHaveBeenCalledWith(5);
    expect(loadSheet).toHaveBeenCalledTimes(1);
    expect(loadSheet).toHaveBeenCalledWith(inputs.id);
    expect(sheetsInOrder(result.current.workbook).map(({ id, revision }) => ({ id, revision }))).toEqual([
      { id: inputs.id, revision: 8 },
      { id: outputs.id, revision: 6 },
    ]);
  });

  it('removes a missing conflicted sheet and drops its queued replacement', async () => {
    const sheet = { ...positionedSheet('sheet-inputs', 'Inputs', { x: 0, y: 0 }), revision: 3 };
    const loadSheet = vi.fn().mockRejectedValue(new WorkbookApiError('sheet-not-found', 404, 'sheet-not-found'));
    const request = vi.fn().mockRejectedValue(
      new WorkbookApiError('sheet-revision-conflict', 409, 'sheet-revision-conflict'),
    );
    const queuedRun = vi.fn().mockResolvedValue({ sheetId: sheet.id, revision: 4 });
    const { result } = renderAutosave({
      apiClient: { loadSheet },
      initialWorkbook: workbookWithSheets([sheet]),
    });

    act(() => {
      result.current.autosave.enqueueEdit({
        sheetId: sheet.id,
        target: renameTarget,
        run: () => result.current.autosave.runRevisionedEdit({
          sheetId: sheet.id,
          request,
          revisionOf: (response: SheetRevisionResponse) => response.revision,
        }),
      });
      enqueueRevisioned(result.current.autosave, { run: queuedRun });
    });

    await waitFor(() => expect(sheetsInOrder(result.current.workbook)).toEqual([]));
    expect(queuedRun).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saved'));
  });

  it('waits for running work after queued work is dropped', async () => {
    const running = deferred<SheetRevisionResponse>();
    const queuedRun = vi.fn().mockResolvedValue({ sheetId: 'sheet-inputs', revision: 2 });
    const { result } = renderAutosave();
    let idle = false;

    act(() => {
      enqueueRevisioned(result.current.autosave, { run: () => running.promise });
      enqueueRevisioned(result.current.autosave, { run: queuedRun });
      void result.current.autosave.waitForSheetIdle('sheet-inputs').then(() => {
        idle = true;
      });
      result.current.autosave.dropSheetQueuedTasks('sheet-inputs');
    });
    expect(idle).toBe(false);
    expect(queuedRun).not.toHaveBeenCalled();

    await act(async () => {
      running.resolve({ sheetId: 'sheet-inputs', revision: 1 });
      await running.promise;
    });
    await waitFor(() => expect(idle).toBe(true));
    expect(result.current.autosave.saveStatus).toBe('saved');
  });

  it('ignores failures explicitly marked as lifecycle cancellations', async () => {
    const { result } = renderAutosave();

    act(() => {
      result.current.autosave.enqueueEdit({
        sheetId: 'sheet-inputs',
        target: { kind: 'delete' },
        run: () => Promise.reject(new Error('cancelled')),
        ignoreFailure: () => true,
      });
    });

    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('saved'));
  });
});
