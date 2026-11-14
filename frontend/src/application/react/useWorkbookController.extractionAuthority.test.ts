import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { autosaveClient } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { useWorkbookController } from './useWorkbookController';

it.each([false, true])('replays an admitted extraction with fresh operation identities and its original authority (sorted: %s)', async (sorted) => {
  const sheet = sheetDocument({ id: 's', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '42' } });
  const neighbor = sheetDocument({ id: 'n', name: 'Sorted', rowCount: 1, columnCount: 1 });
  const initial = workbookWithSheets(sorted ? [sheet, { ...neighbor, sorting: [{ columnId: neighbor.content.columns[0]!, direction: 'ascending' }] }] : [sheet]);
  const cell = cellIdentityAt(sheet.content, 'A1')!;
  const transitionId = 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4';
  let before = initial, after = initial;
  const admit = vi.fn(async (operationId: string, source: Workbook, target: Workbook) => {
    before = source;
    after = { ...target, manifest: { ...target.manifest, revision: 17 } };
    return { operationId, transitionId, alreadyCommitted: false, workbook: after };
  });
  const replay = vi.fn(async (operationId: string, authority: string, direction: 'undo' | 'redo') => ({
    operationId, transitionId: authority, alreadyCommitted: false,
    workbook: direction === 'undo' ? before : after,
  }));
  const api = autosaveClient({ admitModelLifecycle: admit, replayModelLifecycle: replay });
  const { result } = renderHook(() => useWorkbookController({ initialWorkbook: initial, apiClient: api }));
  let submission!: ReturnType<typeof result.current.commands.extractSelection>;
  act(() => { submission = result.current.commands.extractSelection({
    sourceSheetId: 's', selection: { kind: 'cells', start: cell, end: cell },
    targetSheetId: '00000000-0000-0000-0000-000000000001', targetName: 'Target',
    targetRows: ['00000000-0000-0000-0000-000000000002'], targetColumns: ['00000000-0000-0000-0000-000000000003'],
    frame: { position: { x: 30, y: 40 }, size: { width: 300, height: 200 }, zIndex: 2 },
  }); });
  await act(async () => { expect((await submission.completion).ok).toBe(true); });
  expect(result.current.workbook.manifest.revision).toBe(17);
  for (const [index, direction] of (['undo', 'redo', 'undo'] as const).entries()) {
    act(() => result.current.commands[direction]());
    await waitFor(() => expect(replay).toHaveBeenCalledTimes(index + 1));
    await waitFor(() => expect(direction === 'undo' ? result.current.canRedo : result.current.canUndo).toBe(true));
    expect(replay.mock.calls[index]!.slice(1)).toEqual([transitionId, direction]);
    expect(result.current.workbook.manifest.revision).toBe(direction === 'undo' ? before.manifest.revision : 17);
  }
  expect(admit).toHaveBeenCalledOnce();
  expect(new Set([admit.mock.calls[0]![0], ...replay.mock.calls.map((call) => call[0])]).size).toBe(4);
});
