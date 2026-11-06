import { expect, it, vi } from 'vitest';
import type { Workbook } from '@workbook/core/model';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { deferred } from '@test-support/apiClients';
import { replayEntryRecord, type ReplayOperation } from './replayEntryRecord';

function setup() {
  const first = sheetDocument({ id: 'first', name: 'First', rowCount: 2, columnCount: 1 });
  const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 2, columnCount: 1 });
  const before = workbookWithSheets([first, second]);
  const saved = workbookWithSheets([{ ...first, revision: 1 }, { ...second, revision: 1 }]);
  let current = before;
  const coordinator = new WorkbookPersistenceCoordinator();
  const operation: ReplayOperation = { sheetId: 'first', rowId: 'row', operationId: 'op', direction: 'undo' };
  const options = { operation, coordinator, waitForPredecessors: vi.fn(async () => {}), currentWorkbook: () => current,
    loadWorkbook: vi.fn(async () => before), reconcile: vi.fn((value: Workbook) => { current = value; }),
    replay: vi.fn().mockResolvedValue({ operationId: 'op', rowId: 'row', alreadyCommitted: false, workbook: saved }) };
  return { before, saved, options, operation, coordinator };
}

it('drains before capture and adopts all revisions', async () => {
  const { options, coordinator, saved } = setup();
  const drain = deferred<void>();
  options.waitForPredecessors.mockReturnValue(drain.promise);
  const pending = replayEntryRecord(options);
  expect(options.loadWorkbook).not.toHaveBeenCalled();
  drain.resolve();
  await pending;
  expect(options.currentWorkbook()).toEqual(saved);
  expect(coordinator.revision('second')).toBe(1);
});

it('retries the identical frozen request after an ambiguous failure', async () => {
  const { options, before, operation } = setup();
  options.replay.mockRejectedValueOnce(new Error('lost'));
  await expect(replayEntryRecord(options)).rejects.toThrow('lost');
  const frozen = structuredClone(operation.request);
  before.documents.first!.name = 'changed';
  await replayEntryRecord(options);
  expect(operation.request).toEqual(frozen);
  expect(options.replay.mock.calls[0]).toEqual(options.replay.mock.calls[1]);
});

it('rejects overlap and releases the pending marker', async () => {
  const { options, operation } = setup();
  const drain = deferred<void>();
  options.waitForPredecessors.mockReturnValue(drain.promise);
  const pending = replayEntryRecord(options);
  await expect(replayEntryRecord(options)).rejects.toThrow('already pending');
  drain.resolve();
  await pending;
  expect(operation.pending).toBe(false);
});

it('rejects stale receipt snapshots and preserves the request', async () => {
  const { options, coordinator, operation } = setup();
  options.replay.mockImplementation(async () => {
    coordinator.recordRevision('second', 2);
    return { operationId: 'op', rowId: 'row', alreadyCommitted: true, workbook: options.currentWorkbook() };
  });
  await expect(replayEntryRecord(options)).rejects.toThrow('older');
  expect(operation.request).toBeDefined();
});

it('returns current receipt state without recreating a subsequently deleted sheet', async () => {
  const { options, coordinator } = setup();
  options.replay.mockRejectedValueOnce(new Error('lost'));
  await expect(replayEntryRecord(options)).rejects.toThrow('lost');
  const current = workbookWithSheets([]);
  current.manifest.revision = 2;
  options.replay.mockResolvedValue({ operationId: 'op', rowId: 'row', alreadyCommitted: true, workbook: current });
  await replayEntryRecord(options);
  expect(options.currentWorkbook()).toEqual(current);
  expect(coordinator.isSheetMissing('first')).toBe(true);
});

it('retains the frozen operation if recovery refresh fails', async () => {
  const { options, operation } = setup();
  options.replay.mockRejectedValue(new Error('conflict'));
  options.loadWorkbook.mockRejectedValueOnce(new Error('refresh failed'));
  await expect(replayEntryRecord({ ...options, recover: async (_error, refresh) => { await refresh(); throw new Error('conflict'); } })).rejects.toThrow('refresh failed');
  expect(operation.request).toBeUndefined();
  options.loadWorkbook.mockResolvedValueOnce(options.currentWorkbook());
  options.loadWorkbook.mockRejectedValueOnce(new Error('refresh failed'));
  await expect(replayEntryRecord({ ...options, recover: async (_error, refresh) => { await refresh(); throw new Error('conflict'); } })).rejects.toThrow('refresh failed');
  expect(operation.request).toBeDefined();
});

it('fences other workbook writes through adoption and rejects overlapping replay operations', async () => {
  const { options, coordinator } = setup();
  const hold = deferred<void>();
  const predecessor = coordinator.serialize(['first'], async () => { await hold.promise; });
  const pending = replayEntryRecord(options);
  await expect(replayEntryRecord({ ...options, operation: { ...options.operation, operationId: 'other', pending: false } })).rejects.toThrow('already pending');
  expect(options.loadWorkbook).not.toHaveBeenCalled();
  hold.resolve();
  await predecessor;
  await pending;
  options.loadWorkbook.mockResolvedValue(options.currentWorkbook());
  await replayEntryRecord({ ...options, operation: { sheetId: 'first', rowId: 'row', operationId: 'op', direction: 'redo' } });
});
