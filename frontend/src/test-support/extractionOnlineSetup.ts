import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { autosaveClient, deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import type { ExtractionRequest } from '@application/core/extractionPreparation';
import { useWorkbookController } from '@application/react/useWorkbookController';

const receipt = (operationId: string, workbook: Workbook) => ({ operationId, transitionId: 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4', alreadyCommitted: false, workbook });

export function setup(withNeighbor = false, sorted = false) {
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

export async function settle(saves: ReturnType<typeof setup>['saves'], index: number, fail = false) {
  await waitFor(() => expect(saves).toHaveLength(index + 1));
  await act(async () => {
    if (fail) saves[index]!.pending.reject(new Error('offline'));
    else saves[index]!.pending.resolve(saves[index]!.after);
  });
}

