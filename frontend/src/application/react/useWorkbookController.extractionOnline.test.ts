import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { creationReceipt, sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { tabularCellsByA1 } from '@workbook/read/queries';
import type { Workbook } from '@workbook/core/model';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import type { ExtractionRequest } from '@application/core/extractionPreparation';
import { useWorkbookController } from './useWorkbookController';
import { ContentHistory, EXTRACTION_HISTORY_MAX_BYTES } from '@application/core/contentHistory';
import { declaration, manualProperty } from '@test-support/modelLifecycleFixtures';
import { expectBoundedExtraction } from '@test-support/extractionHistoryAssertions';

const receipt = (operationId: string, workbook: Workbook, alreadyCommitted = false) => ({ operationId, transitionId: 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4', alreadyCommitted, workbook });

function sameContent(left: Workbook, right: Workbook): boolean {
  const strip = (w: Workbook) => JSON.stringify({
    ...w,
    manifest: { ...w.manifest, revision: 0 },
    documents: Object.fromEntries(Object.entries(w.documents).map(([id, sheet]) => [id, { ...sheet, revision: 0 }])),
  });
  return strip(left) === strip(right);
}

/** Stands in for the backend lifecycle compare-and-swap: commits atomically, then drops the response. */
function committingLifecycleBackend(initial: Workbook, loseResponse = true) {
  let durable = structuredClone(initial);
  const committed = new Set<string>();
  let transition: { before: Workbook; after: Workbook } | undefined;
  const admitModelLifecycle = vi.fn().mockImplementation((operationId: string, before: Workbook, after: Workbook) => {
    // The exact retry is accepted because current durable state already matches after.
    if (committed.has(operationId)) return Promise.resolve(receipt(operationId, structuredClone(durable), true));
    if (!sameContent(durable, before)) return Promise.reject(new WorkbookApiError('conflict', 409, 'model-lifecycle-conflict'));
    const sameSheetIds = durable.manifest.sheetIds.join('\0') === after.manifest.sheetIds.join('\0');
    durable = {
      ...after,
      manifest: { ...after.manifest, revision: durable.manifest.revision + (sameSheetIds ? 0 : 1) },
      documents: Object.fromEntries(Object.entries(after.documents).map(([id, sheet]) => [id,
        { ...sheet, revision: durable.documents[id]?.revision ?? 0 }])),
    };
    transition = { before, after };
    committed.add(operationId);
    return loseResponse ? Promise.reject(new TypeError('response lost')) : Promise.resolve(receipt(operationId, structuredClone(durable)));
  });
  const replayModelLifecycle = vi.fn().mockImplementation((operationId: string, _transitionId: string, direction: 'undo' | 'redo') => {
    if (committed.has(operationId)) return Promise.resolve(receipt(operationId, structuredClone(durable), true));
    if (!transition || !sameContent(durable, direction === 'undo' ? transition.after : transition.before))
      return Promise.reject(new WorkbookApiError('conflict', 409, 'model-lifecycle-conflict'));
    durable = structuredClone(direction === 'undo' ? transition.before : transition.after);
    committed.add(operationId);
    return loseResponse ? Promise.reject(new TypeError('response lost')) : Promise.resolve(receipt(operationId, structuredClone(durable)));
  });
  return { admitModelLifecycle, replayModelLifecycle, durable: () => durable, setDurable: (value: Workbook) => { durable = value; } };
}

function setup(withNeighbor = false, sorted = false) {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
  sheet.frame.zIndex = 1;
  const neighbor = sheetDocument({ id: 'neighbor', name: 'Neighbor', rowCount: 1, columnCount: 1 });
  neighbor.frame.zIndex = 1;
  if (sorted) neighbor.sorting = [{ columnId: neighbor.content.columns[0]!, direction: 'ascending' }];
  const cell = cellIdentityAt(sheet.content, 'A1')!;
  const request: ExtractionRequest = {
    sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell },
    targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target', targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
    frame: { position: { x: 30, y: 40 }, size: { width: 300, height: 200 }, zIndex: 2 },
  };
  const saves: Array<{ before: Workbook; after: Workbook; pending: ReturnType<typeof deferred<Workbook>> }> = [];
  const save = vi.fn().mockImplementation((operationId: string, before: Workbook, after: Workbook) => {
    const pending = deferred<Workbook>();
    saves.push({ before, after, pending });
    return pending.promise.then((workbook) => receipt(operationId, workbook));
  });
  const replay = vi.fn().mockImplementation((operationId: string, _transitionId: string, direction: 'undo' | 'redo') => {
    const first = saves[0]!;
    const pending = deferred<Workbook>();
    saves.push({ before: direction === 'undo' ? first.after : first.before, after: direction === 'undo' ? first.before : first.after, pending });
    return pending.promise.then((workbook) => receipt(operationId, workbook));
  });
  const hook = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets(withNeighbor ? [sheet, neighbor] : [sheet]), apiClient: autosaveClient({ admitModelLifecycle: save, replayModelLifecycle: replay }) }));
  return { ...hook, request, saves, save, replay };
}

async function settle(saves: ReturnType<typeof setup>['saves'], index: number, fail = false) {
  await waitFor(() => expect(saves).toHaveLength(index + 1));
  await act(async () => {
    if (fail) saves[index]!.pending.reject(new Error('offline'));
    else saves[index]!.pending.resolve(saves[index]!.after);
  });
}

describe('online extraction replay', () => {
  it('undoes and redoes extraction after the server omits empty sheet metadata', async () => {
    const { result, request, saves, replay } = setup();
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    await waitFor(() => expect(saves).toHaveLength(1));
    const authoritative = structuredClone(saves[0]!.after);
    const target = authoritative.documents[request.targetSheetId]!;
    delete target.columnNames;
    delete target.presentation.formatOverrides;
    await act(async () => { saves[0]!.pending.resolve(authoritative); await submission.completion; });
    act(() => result.current.commands.undo());
    await waitFor(() => expect(replay).toHaveBeenCalledOnce());
    await waitFor(() => expect(saves).toHaveLength(2));
    await act(async () => saves[1]!.pending.resolve(saves[1]!.after));
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    act(() => result.current.commands.redo());
    await waitFor(() => expect(saves).toHaveLength(3));
    await act(async () => saves[2]!.pending.resolve(saves[2]!.after));
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])('installs oversized CURRENT without retaining it (recovery: %s, sorted: %s)', async (recover, sorted) => {
    const prepare = vi.spyOn(ContentHistory.prototype, 'prepareExtraction'); const { result, request, saves, save, replay } = setup(true, sorted);
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(JSON.stringify(saves[0]!.after).length).toBeLessThan(EXTRACTION_HISTORY_MAX_BYTES);
    if (recover) {
      await act(async () => { saves[0]!.pending.reject(new TypeError('response lost')); await submission.completion; });
      expect(result.current.canUndo).toBe(false);
      act(() => result.current.commands.retryFailedSaves());
      await waitFor(() => expect(saves).toHaveLength(2));
      expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    }
    const pending = saves[recover ? 1 : 0]!;
    const neighbor = pending.after.documents.neighbor!;
    const cell = cellIdentityKey(cellIdentityAt(neighbor.content, 'A1')!);
    const independentModel = declaration([manualProperty('independent')]);
    const authoritative = { ...pending.after, dataModels: { model: independentModel }, documents: { ...pending.after.documents, neighbor: { ...neighbor, content: { ...neighbor.content, cells: { ...neighbor.content.cells, [cell]: 'x'.repeat(EXTRACTION_HISTORY_MAX_BYTES) } } } } };
    await act(async () => { pending.pending.resolve(authoritative); if (!recover) await submission.completion; });
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    expectBoundedExtraction(prepare.mock.contexts[0] as ContentHistory, saves[0]!.before, saves[0]!.after); prepare.mockRestore(); expect(result.current.workbook.documents.neighbor!.content.cells[cell]).toHaveLength(EXTRACTION_HISTORY_MAX_BYTES);
    const firstReplay = recover ? 2 : 1;
    for (const [index, direction] of (['undo', 'redo', 'undo'] as const).entries()) {
      act(() => result.current.commands[direction]());
      expect(result.current.workbook.documents.neighbor!.content.cells[cell]).toHaveLength(EXTRACTION_HISTORY_MAX_BYTES);
      expect(result.current.workbook.dataModels?.model).toEqual(independentModel);
      await waitFor(() => expect(replay).toHaveBeenCalledTimes(index + 1));
      expect(replay.mock.calls[index]![1]).toBe('dd36b1da-89af-4d7d-b81e-17a9c426f6e4');
      expect(replay.mock.calls[index]![2]).toBe(direction);
      await waitFor(() => expect(saves).toHaveLength(firstReplay + index + 1));
      const optimistic = result.current.workbook;
      await act(async () => { saves[firstReplay + index]!.pending.resolve(optimistic); });
      await waitFor(() => expect(direction === 'undo' ? result.current.canRedo : result.current.canUndo).toBe(true));
      expect(result.current.workbook.documents.neighbor!.content.cells[cell]).toHaveLength(EXTRACTION_HISTORY_MAX_BYTES);
      expect(result.current.workbook.dataModels?.model).toEqual(independentModel);
    }
    expect(save).toHaveBeenCalledTimes(recover ? 2 : 1);
    expect(new Set(replay.mock.calls.map((call) => call[0])).size).toBe(3);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('reloads atomic stacking and data after extraction, undo and redo', async () => {
    const source = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' }, zIndex: 1 });
    const neighbor = sheetDocument({ id: 'neighbor', name: 'Neighbor', rowCount: 1, columnCount: 1, zIndex: 1 });
    const initial = workbookWithSheets([source, neighbor]);
    const cell = cellIdentityAt(source.content, 'A1')!;
    const request: ExtractionRequest = {
      sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell },
      targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target',
      targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
      frame: { position: { x: 30, y: 40 }, size: { width: 300, height: 200 }, zIndex: 2 },
    };
    const server = committingLifecycleBackend(initial, false);
    const api = autosaveClient({ admitModelLifecycle: server.admitModelLifecycle, replayModelLifecycle: server.replayModelLifecycle });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
    const reload = () => {
      const reloaded = renderHook(() => useWorkbookController({ initialWorkbook: structuredClone(server.durable()), apiClient: api }));
      const workbook = reloaded.result.current.workbook;
      reloaded.unmount();
      return workbook;
    };
    const expectExtracted = (workbook: Workbook) => {
      expect(workbook.documents.s!.frame).toEqual(source.frame);
      expect(workbook.documents.neighbor!.frame).toEqual({ ...neighbor.frame, zIndex: 2 });
      expect(workbook.documents[request.targetSheetId]!.frame.zIndex).toBe(1);
      expect(tabularCellsByA1(workbook.documents.s!.content)).toEqual({});
      expect(tabularCellsByA1(workbook.documents[request.targetSheetId]!.content)).toEqual({ A1: '42' });
    };

    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    await act(async () => { expect((await submission.completion).ok).toBe(true); });
    expect(server.admitModelLifecycle).toHaveBeenCalledTimes(1);
    const [, before, after] = server.admitModelLifecycle.mock.calls[0]!;
    expect(before.documents.neighbor.frame).toEqual(neighbor.frame);
    expectExtracted(after);
    expectExtracted(reload());

    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    expect(server.replayModelLifecycle).toHaveBeenCalledTimes(1);
    const undone = reload();
    expect(undone.documents[request.targetSheetId]).toBeUndefined();
    expect(undone.documents.neighbor!.frame).toEqual(neighbor.frame);
    expect(undone.documents.s!.frame).toEqual(source.frame);
    expect(tabularCellsByA1(undone.documents.s!.content)).toEqual({ A1: '42' });

    act(() => result.current.commands.redo());
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    expect(server.replayModelLifecycle).toHaveBeenCalledTimes(2);
    expectExtracted(reload());
    expect(api.updateSheetZOrder).not.toHaveBeenCalled();
  });
  it('rolls back frame insertion and data together when settlement fails', async () => {
    const { result, request, saves, save } = setup(true);
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.before.documents.neighbor!.frame.zIndex).toBe(1);
    expect(saves[0]!.after.documents.neighbor!.frame.zIndex).toBe(2);
    expect(saves[0]!.after.documents[request.targetSheetId]!.frame.zIndex).toBe(1);
    await settle(saves, 0, true);
    expect((await submission.completion).ok).toBe(false);
    expect(result.current.workbook.documents.neighbor!.frame.zIndex).toBe(1);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(result.current.workbook.documents.s!.content).toEqual(saves[0]!.before.documents.s!.content);
    expect(result.current.canUndo).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('settles a queued extraction after a successful predecessor and permits undo', async () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1 });
    const cell = cellIdentityAt(sheet.content, 'A1')!;
    const request: ExtractionRequest = {
      sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell },
      targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target', targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
      frame: { position: { x: 30, y: 40 }, size: { width: 300, height: 200 }, zIndex: 2 },
    };
    const write = deferred<{ sheets: { sheetId: string; revision: number }[] }>();
    const saves: Array<{ after: Workbook; pending: ReturnType<typeof deferred<Workbook>> }> = [];
    const api = autosaveClient({
      replayModelLifecycle: vi.fn().mockImplementation((operationId: string) => {
        const pending = deferred<Workbook>();
        saves.push({ after: workbookWithSheets([sheet]), pending });
        return pending.promise.then((workbook) => receipt(operationId, workbook));
      }),
      writeCells: vi.fn().mockReturnValueOnce(write.promise),
      admitModelLifecycle: vi.fn().mockImplementation((operationId: string, _before: Workbook, after: Workbook) => {
        const pending = deferred<Workbook>();
        saves.push({ after, pending });
        return pending.promise.then((workbook) => receipt(operationId, workbook));
      }),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => {
      result.current.commands.updateCellContent('s', 'A1', '1');
      submission = result.current.commands.extractSelection(request);
    });
    expect(api.admitModelLifecycle).not.toHaveBeenCalled();
    await act(async () => write.resolve({ sheets: [{ sheetId: 's', revision: 7 }] }));
    await waitFor(() => expect(saves).toHaveLength(1));
    await act(async () => { saves[0]!.pending.resolve(saves[0]!.after); await submission.completion; });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.workbook.manifest.sheetIds.filter((id) => id === request.targetSheetId)).toHaveLength(1);
    act(() => result.current.commands.undo());
    await waitFor(() => expect(saves).toHaveLength(2));
    await act(async () => saves[1]!.pending.resolve(saves[1]!.after));
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(result.current.canRedo).toBe(true);
  });

  it('retains the predecessor revision and history when queued extraction fails', async () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1 });
    const cell = cellIdentityAt(sheet.content, 'A1')!;
    const request: ExtractionRequest = {
      sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell },
      targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target', targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
      frame: { position: { x: 30, y: 40 }, size: { width: 300, height: 200 }, zIndex: 2 },
    };
    const write = deferred<{ sheets: { sheetId: string; revision: number }[] }>();
    const save = deferred<Workbook>();
    const api = autosaveClient({
      writeCells: vi.fn().mockReturnValueOnce(write.promise).mockResolvedValue({ sheets: [{ sheetId: 's', revision: 8 }] }),
      admitModelLifecycle: vi.fn().mockImplementationOnce(async (operationId: string, _before: Workbook, _after: Workbook) => { void _before; void _after; return receipt(operationId, await save.promise); }).mockImplementation(async (operationId: string, _before: Workbook, after: Workbook) => receipt(operationId, {
        ...after,
        documents: Object.fromEntries(Object.entries(after.documents).map(([id, sheet]) => [id,
          { ...sheet, revision: _before.documents[id] ? 7 : 0 }])),
      })),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => {
      result.current.commands.updateCellContent('s', 'A1', '1');
      submission = result.current.commands.extractSelection(request);
      expect(submission.result.ok).toBe(true);
      expect(result.current.commands.updateCellContent('s', 'A1', '2')).toEqual({ ok: false, reason: 'pending-model-transition' });
      result.current.commands.undo();
    });
    expect(api.admitModelLifecycle).not.toHaveBeenCalled();
    await act(async () => write.resolve({ sheets: [{ sheetId: 's', revision: 7 }] }));
    await waitFor(() => expect(api.admitModelLifecycle).toHaveBeenCalledOnce());
    await act(async () => { save.reject(new Error('offline')); await submission.completion; });
    expect(result.current.workbook.documents.s!.revision).toBe(7);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    // Admission and history are held while the exact operation is unresolved.
    expect(result.current.canUndo).toBe(false);
    // The ambiguous failure holds admission until the exact operation settles.
    expect(result.current.commands.updateCellContent('s', 'A1', '2')).toEqual({ ok: false, reason: 'pending-model-transition' });
    expect(api.writeCells).toHaveBeenCalledTimes(1);
    act(() => result.current.commands.retryFailedSaves());
    await waitFor(() => expect(api.admitModelLifecycle).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.admitModelLifecycle!).mock.calls[1]![0]).toEqual(vi.mocked(api.admitModelLifecycle!).mock.calls[0]![0]);
    expect(vi.mocked(api.admitModelLifecycle!).mock.calls[1]![1]).toEqual(vi.mocked(api.admitModelLifecycle!).mock.calls[0]![1]);
    await waitFor(() => expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined());
    act(() => result.current.commands.updateCellContent('s', 'A1', '2'));
    await waitFor(() => expect(api.writeCells).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.writeCells).mock.calls[1]![0]).toEqual([{ sheetId: 's', revision: 7 }]);
  });

  it('persists forward, inverse and redo atomically with stable identity and frame', async () => {
    const { result, request, saves, save, replay } = setup();
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    expect(submission.result).toMatchObject({ ok: true, targetSheetId: request.targetSheetId, origin: { row: 0, column: 0 }, extents: { rowCount: 1, columnCount: 1 } });
    expect(result.current.canUndo).toBe(false);
    await settle(saves, 0);
    expect(await submission.completion).toMatchObject({ ok: true, targetSheetId: request.targetSheetId, origin: { row: 0, column: 0 }, extents: { rowCount: 1, columnCount: 1 } });
    expect(result.current.canUndo).toBe(true);
    expect(saves[0]!.after.documents['00000000-0000-0000-0000-000000000001']!.frame).toMatchObject({ ...request.frame, zIndex: 1 });
    act(() => result.current.commands.undo());
    expect(result.current.canRedo).toBe(false);
    await settle(saves, 1);
    expect(result.current.canRedo).toBe(true);
    expect(saves[1]!.before.documents['00000000-0000-0000-0000-000000000001']).toBeDefined();
    expect(saves[1]!.after.documents['00000000-0000-0000-0000-000000000001']).toBeUndefined();
    act(() => result.current.commands.redo());
    await settle(saves, 2);
    expect(result.current.canUndo).toBe(true);
    expect(saves[2]!.after.documents['00000000-0000-0000-0000-000000000001']!.frame).toMatchObject({ ...request.frame, zIndex: 1 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it('holds sheet and axis creation behind extraction settlement', async () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
    const cell = cellIdentityAt(sheet.content, 'A1')!;
    const request: ExtractionRequest = {
      sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell },
      targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target', targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
      frame: { position: { x: 30, y: 40 }, size: { width: 300, height: 200 }, zIndex: 2 },
    };
    const save = deferred<Workbook>();
    const api = autosaveClient({
      admitModelLifecycle: async (operationId: string) => receipt(operationId, await save.promise),
      createSheet: vi.fn().mockImplementation(async () => creationReceipt(sheetDocument({ id: 'new', name: 'New', zIndex: 2 }), result.current.commands.currentWorkbook())),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => {
      submission = result.current.commands.extractSelection(request);
      result.current.commands.appendRow('s');
      result.current.commands.createSheet('New', { x: 0, y: 0 });
    });
    expect(api.appendRow).not.toHaveBeenCalled();
    expect(api.createSheet).not.toHaveBeenCalled();
    await act(async () => { save.resolve(result.current.workbook); await submission.completion; });
    await waitFor(() => expect(api.appendRow).toHaveBeenCalledOnce());
    await waitFor(() => expect(api.createSheet).toHaveBeenCalledOnce());
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
  });

  it('rolls back a failed inverse and redo and holds admission until the exact retry settles', async () => {
    const { result, request, saves } = setup();
    act(() => { result.current.commands.extractSelection(request); });
    await settle(saves, 0);
    act(() => result.current.commands.undo());
    await settle(saves, 1, true);
    expect(result.current.extractionReplayFailure).toBe('persistence-failed');
    expect(result.current.workbook.documents['00000000-0000-0000-0000-000000000001']).toBeDefined();
    expect(result.current.canUndo).toBe(false);
    // The ambiguous failure holds admission until the exact operation settles.
    act(() => result.current.commands.undo());
    expect(saves).toHaveLength(2);
    expect(result.current.extractionReplayFailure).toBe('pending-model-transition');
    act(() => result.current.commands.retryFailedSaves());
    await settle(saves, 2);
    expect(result.current.extractionReplayFailure).toBeUndefined();
    expect(result.current.workbook.documents['00000000-0000-0000-0000-000000000001']).toBeUndefined();
    expect(result.current.canRedo).toBe(true);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.commands.redo());
    await settle(saves, 3, true);
    expect(result.current.extractionReplayFailure).toBe('persistence-failed');
    expect(result.current.workbook.documents['00000000-0000-0000-0000-000000000001']).toBeUndefined();
    expect(result.current.canRedo).toBe(false);
    // The ambiguous failure holds admission until the exact operation settles.
    act(() => result.current.commands.redo());
    expect(saves).toHaveLength(4);
    expect(result.current.extractionReplayFailure).toBe('pending-model-transition');
    act(() => result.current.commands.retryFailedSaves());
    await settle(saves, 4);
    expect(result.current.extractionReplayFailure).toBeUndefined();
    expect(result.current.workbook.documents['00000000-0000-0000-0000-000000000001']).toBeDefined();
    expect(result.current.canUndo).toBe(true);
  });

  it('recovers a forward extraction that committed before its response was lost', async () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
    const cell = cellIdentityAt(sheet.content, 'A1')!;
    const request: ExtractionRequest = {
      sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell },
      targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target',
      targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
      frame: { position: { x: 30, y: 40 }, size: { width: 300, height: 200 }, zIndex: 2 },
    };
    const server = committingLifecycleBackend(workbookWithSheets([sheet]));
    const api = autosaveClient({ admitModelLifecycle: server.admitModelLifecycle, replayModelLifecycle: server.replayModelLifecycle });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    await waitFor(() => expect(server.admitModelLifecycle).toHaveBeenCalledTimes(1));
    await act(async () => { await submission.completion; });
    // The server committed atomically before its response was lost.
    expect(server.durable().documents[request.targetSheetId]).toBeDefined();
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    // Admission and history stay held while the exact operation is unresolved.
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.commands.updateCellContent('s', 'A1', '2')).toEqual({ ok: false, reason: 'pending-model-transition' });
    server.setDurable({ ...server.durable(), manifest: { ...server.durable().manifest, revision: 87 } });
    act(() => result.current.commands.retryFailedSaves());
    await waitFor(() => expect(server.admitModelLifecycle).toHaveBeenCalledTimes(2));
    expect(server.admitModelLifecycle.mock.calls[1]).toEqual(server.admitModelLifecycle.mock.calls[0]);
    // The exact retry recognizes the already-committed snapshot.
    await waitFor(() => expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined());
    expect(result.current.workbook.manifest.revision).toBe(87);
    expect(result.current.workbook.documents[request.targetSheetId]!.revision)
      .toBe(server.durable().documents[request.targetSheetId]!.revision);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.extractionReplayFailure).toBeUndefined();
    // The inverse replay also commits atomically with its response lost.
    act(() => result.current.commands.undo());
    await waitFor(() => expect(server.replayModelLifecycle).toHaveBeenCalledTimes(1));
    expect(server.durable().documents[request.targetSheetId]).toBeUndefined();
    await waitFor(() => expect(result.current.extractionReplayFailure).toBe('persistence-failed'));
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    server.setDurable({ ...server.durable(), manifest: { ...server.durable().manifest, revision: 88 } });
    act(() => result.current.commands.retryFailedSaves());
    await waitFor(() => expect(server.replayModelLifecycle).toHaveBeenCalledTimes(2));
    expect(server.replayModelLifecycle.mock.calls[1]).toEqual(server.replayModelLifecycle.mock.calls[0]);
    await waitFor(() => expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined());
    expect(result.current.workbook.manifest.revision).toBe(88);
    expect(result.current.extractionReplayFailure).toBeUndefined();
    expect(result.current.canRedo).toBe(true);
    expect(result.current.canUndo).toBe(false);
  });

  it('recovers an inverse extraction that committed before its response was lost', async () => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
    const cell = cellIdentityAt(sheet.content, 'A1')!;
    const request: ExtractionRequest = {
      sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell },
      targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target',
      targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
      frame: { position: { x: 30, y: 40 }, size: { width: 300, height: 200 }, zIndex: 2 },
    };
    const server = committingLifecycleBackend(workbookWithSheets([sheet]));
    const api = autosaveClient({ admitModelLifecycle: server.admitModelLifecycle, replayModelLifecycle: server.replayModelLifecycle });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    act(() => { result.current.commands.extractSelection(request); });
    await waitFor(() => expect(server.admitModelLifecycle).toHaveBeenCalledTimes(1));
    act(() => result.current.commands.retryFailedSaves());
    await waitFor(() => expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined());
    // The inverse replay commits atomically; the response is lost.
    act(() => result.current.commands.undo());
    await waitFor(() => expect(server.replayModelLifecycle).toHaveBeenCalledTimes(1));
    expect(server.durable().documents[request.targetSheetId]).toBeUndefined();
    await waitFor(() => expect(result.current.extractionReplayFailure).toBe('persistence-failed'));
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.commands.undo());
    expect(server.replayModelLifecycle).toHaveBeenCalledTimes(1);
    act(() => result.current.commands.retryFailedSaves());
    await waitFor(() => expect(server.replayModelLifecycle).toHaveBeenCalledTimes(2));
    expect(server.replayModelLifecycle.mock.calls[1]).toEqual(server.replayModelLifecycle.mock.calls[0]);
    await waitFor(() => expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined());
    expect(result.current.extractionReplayFailure).toBeUndefined();
    expect(result.current.canRedo).toBe(true);
    expect(result.current.canUndo).toBe(false);
    // The redo commits atomically; the response is lost.
    act(() => result.current.commands.redo());
    await waitFor(() => expect(server.replayModelLifecycle).toHaveBeenCalledTimes(3));
    expect(server.durable().documents[request.targetSheetId]).toBeDefined();
    await waitFor(() => expect(result.current.extractionReplayFailure).toBe('persistence-failed'));
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.commands.retryFailedSaves());
    await waitFor(() => expect(server.replayModelLifecycle).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined());
    expect(result.current.extractionReplayFailure).toBeUndefined();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('reports stale replay without persisting or consuming history', async () => {
    const { result, request, saves, save } = setup();
    act(() => { result.current.commands.extractSelection(request); });
    await settle(saves, 0);
    act(() => { result.current.commands.moveSheetFrame('00000000-0000-0000-0000-000000000001', { x: 99, y: 99 }); });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    act(() => result.current.commands.undo());
    expect(result.current.extractionReplayFailure).toBe('stale-extraction-history');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.workbook.documents['00000000-0000-0000-0000-000000000001']!.frame.position).toEqual({ x: 99, y: 99 });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not consume extraction history or admit a replacement when replay conflicts', async () => {
    const { result, request, saves, save, replay } = setup();
    act(() => { result.current.commands.extractSelection(request); });
    await settle(saves, 0);
    replay.mockRejectedValueOnce(new WorkbookApiError('conflict', 409, 'model-lifecycle-conflict'));
    act(() => result.current.commands.undo());
    await waitFor(() => expect(result.current.extractionReplayFailure).toBeDefined());
    expect(result.current.workbook.documents[request.targetSheetId]).toBeDefined();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'malformed'])('does not record extraction for a %s admission receipt', async (kind) => {
    const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
    const cell = cellIdentityAt(sheet.content, 'A1')!;
    const admit = vi.fn().mockImplementation(async (id: string, _before: Workbook, after: Workbook) =>
      kind === 'missing' ? undefined : { ...receipt(id, after), transitionId: 'invalid' });
    const replay = vi.fn();
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: autosaveClient({ admitModelLifecycle: admit, replayModelLifecycle: replay }) }));
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection({
      sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell },
      targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target',
      targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
      frame: { position: { x: 30, y: 40 }, size: { width: 300, height: 200 }, zIndex: 2 },
    }); });
    await act(async () => { expect((await submission.completion).ok).toBe(false); });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.workbook.documents['00000000-0000-0000-0000-000000000001']).toBeUndefined();
    expect(replay).not.toHaveBeenCalled();
  });
});
