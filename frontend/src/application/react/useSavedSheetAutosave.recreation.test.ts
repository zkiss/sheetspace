import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@test-support/apiClients';
import { positionedSheet, workbookWithSheets } from '@test-support/workbookFactories';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import type { Workbook } from '@workbook/core/model';
import { WorkbookApiError, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { useSavedSheetAutosave } from './useSavedSheetAutosave';
import { useGridAxisCreationOperations } from './useGridAxisCreationOperations';

const source = positionedSheet('source', 'Source', { x: 0, y: 0 });
const target = { ...positionedSheet('target', 'Target', { x: 200, y: 0 }), revision: 9 };
const before = workbookWithSheets([source, target]);
const removed = workbookWithSheets([source]);
const recreated = workbookWithSheets([source, { ...target, revision: 0 }]);
const rename = { kind: 'rename-sheet' as const, sheetId: target.id, name: 'Later' };

function renderShared(api: Partial<WorkbookApi>) {
  const coordinator = new WorkbookPersistenceCoordinator();
  const hook = renderHook(() => {
    const [workbook, setWorkbook] = useState(before);
    const ref = useRef(workbook); ref.current = workbook;
    const update = useCallback<SetWorkbook>((value) => setWorkbook(value), []);
    const autosave = useSavedSheetAutosave({ autosaveEnabled: true, workbook, setWorkbook: update, resolvedApiClient: api, persistenceCoordinator: coordinator });
    const axis = useGridAxisCreationOperations({ autosaveEnabled: true, beforeCreate: autosave.waitForModelTransitions, hasPendingRecreation: autosave.hasPendingRecreation, currentWorkbook: () => ref.current, persistenceCoordinator: coordinator, reconcile: () => undefined, resolvedApiClient: api, setWorkbook: update });
    return { autosave, axis, workbook, setWorkbook };
  });
  return { ...hook, coordinator };
}
async function removeAndRecreate(result: ReturnType<typeof renderShared>['result']) {
  act(() => result.current.autosave.enqueue('remove', { kind: 'model-lifecycle', before, after: removed }));
  await waitFor(() => expect(result.current.autosave.outboxSnapshot.find((entry) => entry.operationId === 'remove')?.status).toBe('succeeded'));
  act(() => { result.current.setWorkbook(before); result.current.autosave.enqueue('recreate', { kind: 'model-lifecycle', before: removed, after: before }); });
}

describe('shared recreation boundaries', () => {
  it('rejects an unrelated missing sheet during recreation', async () => {
    const pending = deferred<Workbook>();
    const appendRow = vi.fn();
    const { result, coordinator } = renderShared({ saveModelLifecycle: vi.fn().mockResolvedValueOnce(removed).mockReturnValueOnce(pending.promise), appendRow });
    await removeAndRecreate(result);
    act(() => coordinator.confirmSheetMissing(source.id, {}));
    act(() => result.current.setWorkbook(before));
    act(() => result.current.axis.appendRow(source.id));
    expect(result.current.axis.hasUnsettled()).toBe(false);
    expect(result.current.axis.creatingAxes[source.id]).toBeUndefined();
    expect(appendRow).not.toHaveBeenCalled();
    await act(async () => pending.resolve(recreated));
  });
  it('blocks successors on failure and retries the exact lifecycle payload', async () => {
    const first = deferred<Workbook>(); const retry = deferred<Workbook>();
    const saveModelLifecycle = vi.fn().mockResolvedValueOnce(removed).mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    const appendRow = vi.fn().mockResolvedValue({ sheetId: target.id, revision: 1, rowCount: 21, rowId: 'row' });
    const renameSheet = vi.fn().mockResolvedValue({ sheetId: target.id, revision: 2 }); const loadSheet = vi.fn();
    const { result } = renderShared({ saveModelLifecycle, appendRow, renameSheet, loadSheet });
    await removeAndRecreate(result);
    act(() => { result.current.axis.appendRow(target.id); result.current.autosave.enqueue('later', rename); });
    await act(async () => first.reject(new Error('offline')));
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('failed'));
    expect(result.current.autosave.outboxSnapshot.find((entry) => entry.operationId === 'recreate')).toMatchObject({ status: 'failed', failure: expect.any(Error) });
    expect(result.current.autosave.outboxSnapshot.find((entry) => entry.operationId === 'later')?.status).toBe('queued');
    expect(result.current.axis.hasUnsettled()).toBe(true);
    expect(result.current.axis.creatingAxes[target.id].rows).toHaveLength(1);
    expect(appendRow).not.toHaveBeenCalled(); expect(renameSheet).not.toHaveBeenCalled();
    act(() => result.current.autosave.retryFailedSaves());
    await waitFor(() => expect(saveModelLifecycle).toHaveBeenCalledTimes(3));
    expect(saveModelLifecycle.mock.calls[2]).toEqual(saveModelLifecycle.mock.calls[1]);
    expect(result.current.autosave.outboxSnapshot.find((entry) => entry.operationId === 'recreate')?.status).toBe('running');
    expect(loadSheet).not.toHaveBeenCalled(); expect(appendRow).not.toHaveBeenCalled(); expect(renameSheet).not.toHaveBeenCalled();
    await act(async () => retry.resolve(recreated));
    await waitFor(() => expect(appendRow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(renameSheet).toHaveBeenCalledTimes(1));
    expect([appendRow.mock.calls[0][1].revision, renameSheet.mock.calls[0][2].revision].sort()).toEqual([0, 1]);
  });
  it('settles missing successors after rollback and discard without discarding unrelated work', async () => {
    const first = deferred<Workbook>();
    const appendRow = vi.fn(); const renameSheet = vi.fn().mockResolvedValue({ sheetId: source.id, revision: 1 });
    const { result } = renderShared({ saveModelLifecycle: vi.fn().mockResolvedValueOnce(removed).mockReturnValueOnce(first.promise), appendRow, renameSheet });
    await removeAndRecreate(result);
    act(() => { result.current.axis.appendRow(target.id); result.current.autosave.enqueue('later', rename); result.current.autosave.enqueue('live', { ...rename, sheetId: source.id }); });
    await act(async () => first.reject(new Error('offline')));
    await waitFor(() => expect(result.current.autosave.saveStatus).toBe('failed'));
    act(() => { result.current.setWorkbook(removed); result.current.autosave.discard('recreate'); });
    await waitFor(() => expect(result.current.axis.hasUnsettled()).toBe(false));
    await waitFor(() => expect(result.current.autosave.outboxSnapshot.find((entry) => entry.operationId === 'later')?.status).toBe('succeeded'));
    await waitFor(() => expect(renameSheet).toHaveBeenCalledWith(source.id, 'Later', { revision: 0 }));
    expect(appendRow).not.toHaveBeenCalled(); expect(renameSheet).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('restores confirmed missing sheet; append during recreation: %s', async (during) => {
    const pending = deferred<Workbook>();
    const renameSheet = vi.fn().mockRejectedValue(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'));
    const loadSheet = vi.fn().mockRejectedValue(new WorkbookApiError('missing', 404, 'sheet-not-found'));
    const appendRow = vi.fn().mockResolvedValue({ sheetId: target.id, revision: 1, rowCount: 21, rowId: 'row' });
    const { result } = renderShared({ saveModelLifecycle: vi.fn().mockReturnValue(pending.promise), renameSheet, loadSheet, appendRow });
    act(() => result.current.autosave.enqueue('old', rename));
    await waitFor(() => expect(result.current.workbook.manifest.sheetIds).not.toContain(target.id));
    act(() => { result.current.setWorkbook(before); result.current.autosave.enqueue('recreate', { kind: 'model-lifecycle', before: removed, after: before }); });
    if (during) act(() => result.current.axis.appendRow(target.id));
    expect(appendRow).not.toHaveBeenCalled();
    await act(async () => pending.resolve(recreated));
    await waitFor(() => expect(result.current.autosave.outboxSnapshot.find((entry) => entry.operationId === 'recreate')?.status).toBe('succeeded'));
    if (!during) act(() => result.current.axis.appendRow(target.id));
    await waitFor(() => expect(appendRow).toHaveBeenCalledWith(target.id, { revision: 0 }));
    expect(renameSheet).toHaveBeenCalledTimes(1);
  });
  it('retains deletion preparation during recreation admission', async () => {
    const pending = deferred<Workbook>(); const appendRow = vi.fn();
    const { result } = renderShared({ saveModelLifecycle: vi.fn().mockResolvedValueOnce(removed).mockReturnValueOnce(pending.promise), appendRow });
    await removeAndRecreate(result);
    act(() => { result.current.axis.prepareSheetDeletion(target.id); result.current.axis.appendRow(target.id); });
    expect(result.current.axis.hasUnsettled()).toBe(false); expect(appendRow).not.toHaveBeenCalled();
    await act(async () => pending.resolve(recreated));
  });
});
