import { expect, it, vi } from 'vitest';
import { workbookWithSheets } from '@test-support/workbookFactories';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { WorkbookMutationBarrier } from './workbookMutationBarrier';
import { ContentHistory } from './contentHistory';
import { replayEntryRecord } from './replayEntryRecord';
import { RecordReplayOwner } from './recordReplayOwner';

function setup() {
  const history = new ContentHistory();
  history.recordModelRecord({ sheetId: 's', rowId: 'r' });
  const owner = new RecordReplayOwner(history);
  const workbook = workbookWithSheets([]);
  const coordinator = new WorkbookPersistenceCoordinator();
  const barrier = new WorkbookMutationBarrier();
  const replay = vi.fn(async (_sheet: string, rowId: string, request: { operationId: string }) => ({ operationId: request.operationId, rowId, alreadyCommitted: false, workbook }));
  const execute = (operation: Parameters<typeof replayEntryRecord>[0]['operation']) => barrier.run({
    hasUnsettled: () => false, snapshot: () => [], waitFor: async () => { throw new Error('unexpected'); },
    execute: () => replayEntryRecord({ operation, coordinator, waitForPredecessors: async () => {},
      currentWorkbook: () => workbook, loadWorkbook: async () => workbook, replay, reconcile: () => {} }),
  });
  return { history, owner, barrier, replay, execute };
}

it('retries ambiguous dispatch with the same request and allocates a new cycle after success', async () => {
  const { history, owner, barrier, replay, execute } = setup();
  replay.mockRejectedValueOnce(new Error('lost'));
  const transaction = history.peekUndo()!;
  await expect(owner.replay(transaction, 'undo', execute)).rejects.toThrow('lost');
  expect(history.canUndo).toBe(true);
  expect(barrier.held).toBe(false);
  await owner.replay(transaction, 'undo', execute);
  expect(replay.mock.calls[1]).toEqual(replay.mock.calls[0]);
  await owner.replay(history.peekRedo()!, 'redo', execute);
  expect(replay.mock.calls[2]![2].operationId).not.toBe(replay.mock.calls[1]![2].operationId);
  expect(history.canUndo).toBe(true);
});

it('rejects overlapping replay and does not move a changed cursor', async () => {
  const { history, owner } = setup();
  const transaction = history.peekUndo()!;
  let finish!: () => void;
  const pending = owner.replay(transaction, 'undo', () => new Promise<void>((resolve) => { finish = resolve; }));
  await expect(owner.replay(transaction, 'undo', async () => {})).rejects.toThrow('already pending');
  history.recordOrder({ sheetId: 's', axis: 'row', before: ['a'], after: ['b'] });
  finish();
  await expect(pending).rejects.toThrow('history position changed');
  expect(history.peekUndo()?.kind).toBe('axis-order');
});

it('does not dispatch if a predecessor failed and releases the barrier', async () => {
  const { history, owner, barrier, replay } = setup();
  const run = () => barrier.run({ hasUnsettled: () => false, snapshot: () => [{ operationId: 'save', status: 'failed' }],
    waitFor: async () => { throw new Error('unexpected'); }, execute: async () => replay('s', 'r', { operationId: 'x' }) });
  await expect(owner.replay(history.peekUndo()!, 'undo', run)).rejects.toThrow('failed saves');
  expect(replay).not.toHaveBeenCalled();
  expect(barrier.held).toBe(false);
  expect(history.canUndo).toBe(true);
});

it('retires a reconciled rejection and retries with a fresh identity', async () => {
  const { history, owner, replay, execute } = setup();
  const workbook = workbookWithSheets([]);
  const coordinator = new WorkbookPersistenceCoordinator();
  replay.mockRejectedValueOnce(new Error('conflict'));
  const rejected = (operation: Parameters<typeof replayEntryRecord>[0]['operation']) => replayEntryRecord({
    operation, coordinator, waitForPredecessors: async () => {}, currentWorkbook: () => workbook,
    loadWorkbook: async () => workbook, replay, reconcile: () => {},
    recover: async (error, refresh) => { await refresh(); throw error; },
  });
  await expect(owner.replay(history.peekUndo()!, 'undo', rejected)).rejects.toThrow('conflict');
  expect(history.canUndo).toBe(true);
  await owner.replay(history.peekUndo()!, 'undo', execute);
  expect(replay.mock.calls[1]![2].operationId).not.toBe(replay.mock.calls[0]![2].operationId);
});

it('refuses a retained retry when a different record becomes current', async () => {
  const { history, owner, replay, execute } = setup();
  replay.mockRejectedValueOnce(new Error('lost'));
  await expect(owner.replay(history.peekUndo()!, 'undo', execute)).rejects.toThrow('lost');
  history.recordModelRecord({ sheetId: 's', rowId: 'other' });
  await expect(owner.replay(history.peekUndo()!, 'undo', execute)).rejects.toThrow('Resolve the pending');
  expect(replay).toHaveBeenCalledOnce();
});
