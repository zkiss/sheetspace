import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import type { ExtractionRequest } from '@application/core/extractionPreparation';
import { useWorkbookController } from './useWorkbookController';

function setup() {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
  const cell = cellIdentityAt(sheet.content, 'A1')!;
  const request: ExtractionRequest = {
    sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell },
    targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target', targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
    frame: { position: { x: 30, y: 40 }, size: { width: 300, height: 200 }, zIndex: 2 },
  };
  const saves: Array<{ before: Workbook; after: Workbook; pending: ReturnType<typeof deferred<Workbook>> }> = [];
  const save = vi.fn().mockImplementation((before: Workbook, after: Workbook) => {
    const pending = deferred<Workbook>();
    saves.push({ before, after, pending });
    return pending.promise;
  });
  const hook = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: autosaveClient({ saveModelLifecycle: save }) }));
  return { ...hook, request, saves, save };
}

async function settle(saves: ReturnType<typeof setup>['saves'], index: number, fail = false) {
  await waitFor(() => expect(saves).toHaveLength(index + 1));
  await act(async () => {
    if (fail) saves[index]!.pending.reject(new Error('offline'));
    else saves[index]!.pending.resolve(saves[index]!.after);
  });
}

describe('online extraction replay', () => {
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
      writeCells: vi.fn().mockReturnValueOnce(write.promise),
      saveModelLifecycle: vi.fn().mockImplementation((_before: Workbook, after: Workbook) => {
        const pending = deferred<Workbook>();
        saves.push({ after, pending });
        return pending.promise;
      }),
    });
    const { result } = renderHook(() => useWorkbookController({ initialWorkbook: workbookWithSheets([sheet]), apiClient: api }));
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => {
      result.current.commands.updateCellContent('s', 'A1', '1');
      submission = result.current.commands.extractSelection(request);
    });
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
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
      saveModelLifecycle: vi.fn().mockReturnValue(save.promise),
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
    expect(api.saveModelLifecycle).not.toHaveBeenCalled();
    await act(async () => write.resolve({ sheets: [{ sheetId: 's', revision: 7 }] }));
    await waitFor(() => expect(api.saveModelLifecycle).toHaveBeenCalledOnce());
    await act(async () => { save.reject(new Error('offline')); await submission.completion; });
    expect(result.current.workbook.documents.s!.revision).toBe(7);
    expect(result.current.workbook.documents[request.targetSheetId]).toBeUndefined();
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.commands.updateCellContent('s', 'A1', '2'));
    await waitFor(() => expect(api.writeCells).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.writeCells).mock.calls[1]![0]).toEqual([{ sheetId: 's', revision: 7 }]);
  });

  it('persists forward, inverse and redo atomically with stable identity and frame', async () => {
    const { result, request, saves, save } = setup();
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    expect(submission.result).toMatchObject({ ok: true, targetSheetId: request.targetSheetId, origin: { row: 0, column: 0 }, extents: { rowCount: 1, columnCount: 1 } });
    expect(result.current.canUndo).toBe(false);
    await settle(saves, 0);
    expect(await submission.completion).toMatchObject({ ok: true, targetSheetId: request.targetSheetId, origin: { row: 0, column: 0 }, extents: { rowCount: 1, columnCount: 1 } });
    expect(result.current.canUndo).toBe(true);
    expect(saves[0]!.after.documents['00000000-0000-0000-0000-000000000001']!.frame).toMatchObject(request.frame);
    act(() => result.current.commands.undo());
    expect(result.current.canRedo).toBe(false);
    await settle(saves, 1);
    expect(result.current.canRedo).toBe(true);
    expect(saves[1]!.before.documents['00000000-0000-0000-0000-000000000001']).toBeDefined();
    expect(saves[1]!.after.documents['00000000-0000-0000-0000-000000000001']).toBeUndefined();
    act(() => result.current.commands.redo());
    await settle(saves, 2);
    expect(result.current.canUndo).toBe(true);
    expect(saves[2]!.after.documents['00000000-0000-0000-0000-000000000001']!.frame).toMatchObject(request.frame);
    expect(save).toHaveBeenCalledTimes(3);
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
      saveModelLifecycle: () => save.promise,
      createSheet: vi.fn().mockResolvedValue(sheetDocument({ id: 'new', name: 'New' })),
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

  it('retains history and rolls back failed inverse and redo', async () => {
    const { result, request, saves } = setup();
    act(() => { result.current.commands.extractSelection(request); });
    await settle(saves, 0);
    act(() => result.current.commands.undo());
    await settle(saves, 1, true);
    expect(result.current.extractionReplayFailure).toBe('persistence-failed');
    expect(result.current.workbook.documents['00000000-0000-0000-0000-000000000001']).toBeDefined();
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.commands.undo());
    await settle(saves, 2);
    expect(result.current.extractionReplayFailure).toBeUndefined();
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.commands.redo());
    await settle(saves, 3, true);
    expect(result.current.extractionReplayFailure).toBe('persistence-failed');
    expect(result.current.workbook.documents['00000000-0000-0000-0000-000000000001']).toBeUndefined();
    expect(result.current.canRedo).toBe(true);
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
});
