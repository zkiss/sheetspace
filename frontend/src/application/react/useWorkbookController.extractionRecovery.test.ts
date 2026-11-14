import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import type { ExtractionRequest } from '@application/core/extractionPreparation';
import { useWorkbookController } from './useWorkbookController';

const receipt = (operationId: string, workbook: Workbook) => ({ operationId, transitionId: 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4', alreadyCommitted: false, workbook });

function setup(withNeighbor = false) {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
  sheet.frame.zIndex = 1;
  const neighbor = sheetDocument({ id: 'neighbor', name: 'Neighbor', rowCount: 1, columnCount: 1 });
  neighbor.frame.zIndex = 1;
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

describe('extraction recovery', () => {
  it('preserves independent cell and model edits recovered with the admission receipt across replay', async () => {
    const { result, request, saves, save, replay } = setup(true);
    let submission!: ReturnType<typeof result.current.commands.extractSelection>;
    act(() => { submission = result.current.commands.extractSelection(request); });
    await waitFor(() => expect(saves).toHaveLength(1));
    await act(async () => { saves[0]!.pending.reject(new TypeError('response lost')); await submission.completion; });
    act(() => result.current.commands.retryFailedSaves());
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    const admitted = saves[1]!.after;
    const neighbor = admitted.documents.neighbor!;
    const cell = cellIdentityKey(cellIdentityAt(neighbor.content, 'A1')!);
    const model: NonNullable<Workbook['dataModels']>[string] = { id: 'model', name: 'Independent', columns: [{ id: 'input', name: 'Input', kind: 'manual', type: 'int' }] };
    const current = { ...admitted, dataModels: { model }, documents: { ...admitted.documents, neighbor: { ...neighbor, content: { ...neighbor.content, cells: { ...neighbor.content.cells, [cell]: 'independent' } } } } };
    await act(async () => { saves[1]!.pending.resolve(current); });
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    act(() => result.current.commands.undo());
    expect(result.current.workbook.documents.neighbor!.content.cells[cell]).toBe('independent');
    expect(result.current.workbook.dataModels).toEqual({ model });
    await waitFor(() => expect(replay).toHaveBeenCalledTimes(1));
    const undone = { ...saves[0]!.before, dataModels: { model }, documents: { ...saves[0]!.before.documents, neighbor: { ...current.documents.neighbor, frame: saves[0]!.before.documents.neighbor!.frame } } };
    await act(async () => { saves[2]!.pending.resolve(undone); });
    await waitFor(() => expect(result.current.canRedo).toBe(true));
    act(() => result.current.commands.redo());
    expect(result.current.workbook.documents.neighbor!.content.cells[cell]).toBe('independent');
    expect(result.current.workbook.dataModels).toEqual({ model });
    await waitFor(() => expect(replay).toHaveBeenCalledTimes(2));
    await act(async () => { saves[3]!.pending.resolve(current); });
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    expect(result.current.workbook.documents.neighbor!.content.cells[cell]).toBe('independent');
    expect(result.current.workbook.dataModels).toEqual({ model });
  });
});
