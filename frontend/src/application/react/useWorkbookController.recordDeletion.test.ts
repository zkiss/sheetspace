import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkbookCommands } from './workbookControllerTypes';
import { useWorkbookController } from './useWorkbookController';
import { deletionFixture, endpointContents } from '@test-support/recordDeletionFixture';
import { deferred } from '@test-support/apiClients';
import type { Workbook } from '@workbook/core/model';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';

describe('persisted model record deletion', () => {
  it.each([false, true])('captures and replays authoritative endpoints with sorting %s', async (sorting) => {
    const { api, initial, rowId } = deletionFixture(sorting);
    const publication = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await act(async () => {
      const submission = result.current.commands.deleteRow('sheet', rowId, publication);
      expect(submission.result.ok).toBe(true);
      expect(result.current.commands.currentWorkbook()).toEqual(initial);
      expect(publication).not.toHaveBeenCalled();
      expect((await submission.completion).ok).toBe(true);
    });
    const deleted = result.current.workbook;
    expect(deleted.documents.sheet!.content.rows).toEqual(sorting
      ? [...initial.documents.sheet!.content.rows.slice(1)].reverse() : initial.documents.sheet!.content.rows.slice(1));
    expect(publication).toHaveBeenCalledOnce();
    expect(publication).toHaveBeenCalledWith(initial, deleted, 'optimistic');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(await api.loadWorkbook()).toEqual(deleted);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    expect(endpointContents(result.current.workbook)).toEqual(endpointContents(initial));
    expect(result.current.canUndo).toBe(false);
    expect(await api.loadWorkbook()).toEqual(result.current.workbook);
    act(() => result.current.commands.redo());
    await waitFor(() => expect(result.current.canRedo).toBe(false));
    expect(endpointContents(result.current.workbook)).toEqual(endpointContents(deleted));
    expect(await api.loadWorkbook()).toEqual(result.current.workbook);
    expect(api.replayRecordDeletion.mock.calls.map((call) => call[3].direction)).toEqual(['undo', 'redo']);
    expect(new Set(api.replayRecordDeletion.mock.calls.map((call) => call[2])).size).toBe(1);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    await act(async () => { await result.current.commands.deleteRow('sheet', rowId).completion; });
    expect(api.deleteRecord.mock.calls[1]![2].operationId).not.toBe(api.deleteRecord.mock.calls[0]![2].operationId);
    const receipts = await Promise.all(api.deleteRecord.mock.results.map((call) => call.value));
    expect(receipts[0].deletionId).not.toBe(receipts[1].deletionId);
    expect(result.current.canRedo).toBe(false);
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    expect(api.admitRecord).not.toHaveBeenCalled();
    expect(api.replayRecord).not.toHaveBeenCalled();
    expect(api.writeCells).not.toHaveBeenCalled();
    expect(api.writeAxisOrder).not.toHaveBeenCalled();
  });

  it.each([false, true])('retains lost capture and fences ordinary/semantic writes with sorting %s', async (sorting) => {
    const { api, initial, rowId, loseNextResponse } = deletionFixture(sorting);
    loseNextResponse();
    const publication = vi.fn();
    const replacementPublication = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    const old = result.current.commands;
    let completion!: ReturnType<WorkbookCommands['deleteRow']>['completion'];
    act(() => {
      completion = old.deleteRow('sheet', rowId, publication).completion;
      expect(old.deleteRow('sheet', rowId).result).toEqual({ ok: false, reason: 'pending-model-transition' });
      expect(old.updateCellContent('other', 'A1', '5').ok).toBe(false);
    });
    await act(async () => { expect(await completion).toEqual({ ok: false, reason: 'persistence-failed' }); });
    expect(result.current.recordDeletion).toMatchObject({ pending: false, unresolved: true, error: expect.stringMatching(/response lost/) });
    expect(result.current.workbook).toEqual(initial);
    expect(publication).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(false);
    act(() => {
      expect(old.updateCellContent('other', 'A1', '5').ok).toBe(false);
      expect(old.configureSorting('sheet', []).result.ok).toBe(false);
      expect(old.createSheet('New', { x: 0, y: 0 }).ok).toBe(false);
      expect(old.deleteRow('sheet', initial.documents.sheet!.content.rows[1]!).result.ok).toBe(false);
      old.appendRow('other'); old.appendColumn('other'); old.retryFailedSaves(); old.undo(); old.redo();
      result.current.retryStartupLoad();
    });
    expect(api.deleteRecord).toHaveBeenCalledOnce();
    expect(api.replayRecordDeletion).not.toHaveBeenCalled();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    expect(api.writeCells).not.toHaveBeenCalled();
    act(() => old.confirmRecordDeletion());
    await waitFor(() => expect(result.current.recordDeletion.unresolved).toBe(false));
    expect(api.deleteRecord.mock.calls[1]).toEqual(api.deleteRecord.mock.calls[0]);
    expect(publication).toHaveBeenCalledOnce();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.recordDeletion.error).toBeUndefined();
    act(() => old.confirmRecordDeletion());
    expect(api.deleteRecord).toHaveBeenCalledTimes(2);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    expect(result.current.canUndo).toBe(false);
    expect(endpointContents(result.current.workbook)).toEqual(endpointContents(initial));
    loseNextResponse();
    await act(async () => { await old.deleteRow('sheet', rowId, publication).completion; });
    await act(async () => { await old.deleteRow('sheet', rowId, replacementPublication).completion; });
    expect(replacementPublication).not.toHaveBeenCalled();
    expect(publication).toHaveBeenCalledTimes(2);
  });

  it('does not capture when a queued predecessor fails during the checked drain', async () => {
    const { api, initial, rowId } = deletionFixture();
    const predecessor = deferred<{ sheets: { sheetId: string; revision: number }[] }>();
    api.writeCells.mockReturnValue(predecessor.promise);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    act(() => { result.current.commands.updateCellContent('other', 'A1', '5'); });
    await waitFor(() => expect(api.writeCells).toHaveBeenCalledOnce());
    let completion!: ReturnType<WorkbookCommands['deleteRow']>['completion'];
    act(() => { completion = result.current.commands.deleteRow('sheet', rowId).completion; });
    await act(async () => { predecessor.reject(new Error('save failed')); expect((await completion).ok).toBe(false); });
    expect(api.deleteRecord).not.toHaveBeenCalled();
    expect(result.current.recordDeletion.unresolved).toBe(false);
    expect(result.current.workbook.documents.sheet).toEqual(initial.documents.sheet);
    act(() => expect(result.current.commands.deleteRow('sheet', rowId).result).toEqual({ ok: false, reason: 'blocked-persistence-prerequisite' }));
  });

  it.each([false, true])('retains failed replay and fences ordinary/semantic writes with sorting %s', async (sorting) => {
    const { api, initial, rowId } = deletionFixture(sorting);
    const replay = api.replayRecordDeletion.getMockImplementation()!;
    api.replayRecordDeletion.mockRejectedValueOnce(new Error('response lost'));
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await act(async () => { expect((await result.current.commands.deleteRow('sheet', rowId).completion).ok).toBe(true); });
    const deleted = result.current.workbook;
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(true));
    expect(result.current.workbook).toEqual(deleted);
    expect(result.current.canRedo).toBe(false);
    const firstRequest = structuredClone(api.replayRecordDeletion.mock.calls[0]);
    act(() => {
      expect(result.current.commands.updateCellContent('other', 'A1', '5').ok).toBe(false);
      expect(result.current.commands.configureSorting('sheet', []).result.ok).toBe(false);
      expect(result.current.commands.deleteRow('sheet', initial.documents.sheet!.content.rows[1]!).result.ok).toBe(false);
      result.current.commands.redo();
    });
    expect(api.replayRecordDeletion).toHaveBeenCalledOnce();
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    expect(api.writeCells).not.toHaveBeenCalled();
    api.replayRecordDeletion.mockImplementation(replay);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(false));
    expect(api.replayRecordDeletion.mock.calls[1]).toEqual(firstRequest);
    expect(result.current.canRedo).toBe(true);
    expect(endpointContents(result.current.workbook)).toEqual(endpointContents(initial));
  });

  it('confirms a committed replay after its response is lost without applying it twice', async () => {
    const { api, initial, rowId, loseNextReplayResponse } = deletionFixture();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await act(async () => { expect((await result.current.commands.deleteRow('sheet', rowId).completion).ok).toBe(true); });
    const deleted = result.current.workbook;
    loseNextReplayResponse();
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(true));
    expect(result.current.workbook).toEqual(deleted);
    const committed = await api.loadWorkbook();
    expect(endpointContents(committed)).toEqual(endpointContents(initial));
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(false));
    expect(api.replayRecordDeletion.mock.calls[1]).toEqual(api.replayRecordDeletion.mock.calls[0]);
    expect(await api.replayRecordDeletion.mock.results[1]!.value).toMatchObject({ alreadyCommitted: true });
    expect(result.current.workbook).toEqual(committed);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    loseNextReplayResponse();
    act(() => result.current.commands.redo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(true));
    expect(result.current.workbook).toEqual(committed);
    const committedRedo = await api.loadWorkbook();
    act(() => result.current.commands.redo());
    await waitFor(() => expect(result.current.recordReplay.unresolved).toBe(false));
    await waitFor(() => expect(result.current.canRedo).toBe(false));
    expect(api.replayRecordDeletion.mock.calls[3]).toEqual(api.replayRecordDeletion.mock.calls[2]);
    expect(await api.replayRecordDeletion.mock.results[3]!.value).toMatchObject({ alreadyCommitted: true });
    expect(result.current.workbook).toEqual(committedRedo);
    expect(api.replayRecordDeletion.mock.calls[2]![3].operationId).not.toBe(api.replayRecordDeletion.mock.calls[0]![3].operationId);
    expect(endpointContents(result.current.workbook)).toEqual(endpointContents(deleted));
  });

  it('does not publish a deletion or create history when capture conflicts', async () => {
    const { api, initial, rowId } = deletionFixture();
    api.deleteRecord.mockRejectedValueOnce(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'));
    const publication = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    await act(async () => {
      expect((await result.current.commands.deleteRow('sheet', rowId, publication).completion).ok).toBe(false);
    });
    expect(publication).not.toHaveBeenCalled();
    expect(result.current.workbook).toEqual(initial);
    expect(await api.loadWorkbook()).toEqual(initial);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.recordDeletion.unresolved).toBe(false);
    expect(api.replayRecordDeletion).not.toHaveBeenCalled();
  });

  it('holds the admission fence before authoritative preparation finishes and releases after failure', async () => {
    const { api, initial, rowId } = deletionFixture();
    const load = deferred<Workbook>();
    api.loadWorkbook.mockReturnValueOnce(load.promise);
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    let completion!: ReturnType<WorkbookCommands['deleteRow']>['completion'];
    act(() => { completion = result.current.commands.deleteRow('sheet', rowId).completion; });
    expect(result.current.recordDeletion.pending).toBe(true);
    act(() => expect(result.current.commands.updateCellContent('other', 'A1', '5').ok).toBe(false));
    await act(async () => { load.reject(new Error('offline')); expect((await completion).ok).toBe(false); });
    expect(api.deleteRecord).not.toHaveBeenCalled();
    expect(result.current.recordDeletion.unresolved).toBe(false);
    act(() => expect(result.current.commands.updateCellContent('other', 'A1', '5').ok).toBe(true));
  });
});
