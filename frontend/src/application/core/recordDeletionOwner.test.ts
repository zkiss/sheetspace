import { expect, it, vi } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { recoverRecordReplay } from '@infrastructure/persistence/recoverRecordReplay';
import { WorkbookApiError } from '@infrastructure/persistence/workbookApi';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { deferred } from '@test-support/apiClients';
import type { Workbook } from '@workbook/core/model';
import { RecordDeletionOwner } from './recordDeletionOwner';
import type { RecordDeletionRequest } from './recordReplay';
import { deleteRow } from './deleteRow';

function deleted(workbook: Workbook, row: string) {
  const result = deleteRow(workbook, 's', row);
  if (!result.ok) throw new Error('Missing test row');
  return result.value;
}

function setup() {
  const sheet = sheetDocument({ id: 's', name: 'Sheet', rowCount: 3, columnCount: 1, cells: { A1: '3', A2: '2', A3: '1' } });
  const before: Workbook = { ...workbookWithSheets([{ ...sheet, modelId: 'model', sorting: [{ columnId: 's:column:1', direction: 'ascending' }] }]),
    dataModels: { model: { id: 'model', name: 'Model', columns: [] } } };
  let current = before;
  const coordinator = new WorkbookPersistenceCoordinator();
  const owner = new RecordDeletionOwner();
  const options = { coordinator, calculator: new FormulaCalculation(), waitForPredecessors: vi.fn(async () => {}),
    currentWorkbook: () => current, loadWorkbook: vi.fn(async () => before), reconcile: vi.fn((value: Workbook) => { current = value; }),
    deleteRecord: vi.fn(async (_sheet: string, row: string, request: RecordDeletionRequest) => ({ operationId: request.operationId, rowId: row, deletionId: request.operationId, alreadyCommitted: false, workbook: deleted(before, row) })) };
  return { owner, options, before, sheet, coordinator };
}

it('drains and serializes before capturing induced sorting orders', async () => {
  const { owner, options, sheet, coordinator, before } = setup();
  const hold = deferred<void>();
  const prior = coordinator.serialize(['s'], async () => hold.promise);
  const pending = owner.start('s', sheet.content.rows[0]!, options);
  expect(owner.pending).toBe(true);
  await Promise.resolve();
  expect(options.loadWorkbook).not.toHaveBeenCalled();
  hold.resolve(); await prior; await pending;
  expect(options.deleteRecord.mock.calls[0]![2]).toMatchObject({ before, rowOrders: [{ sheetId: 's', order: [sheet.content.rows[2], sheet.content.rows[1]] }] });
  expect(owner.pending).toBe(false);
});

it('retains immutable identity and request across lost responses and confirms only once', async () => {
  const { owner, options, sheet, before } = setup();
  options.deleteRecord.mockRejectedValueOnce(new Error('lost'));
  await expect(owner.start('s', sheet.content.rows[0]!, options)).rejects.toThrow('lost');
  const request = structuredClone(options.deleteRecord.mock.calls[0]);
  before.documents.s!.name = 'changed';
  await expect(owner.start('s', sheet.content.rows[1]!, options)).rejects.toThrow('Resolve');
  options.deleteRecord.mockImplementationOnce(async (_s, row, payload) => ({ operationId: payload.operationId, rowId: row, deletionId: payload.operationId, alreadyCommitted: true, workbook: options.currentWorkbook() }));
  await owner.confirmRetained(options);
  expect(options.deleteRecord.mock.calls[1]).toEqual(request);
  expect(options.loadWorkbook).toHaveBeenCalledOnce();
  await expect(owner.confirmRetained(options)).rejects.toThrow('no unresolved');
  await owner.start('s', sheet.content.rows[1]!, options);
  expect(options.deleteRecord.mock.calls[2]![2].operationId).not.toBe(request![2].operationId);
});

it.each([{ operationId: null }, { rowId: 'wrong' }, { deletionId: '' }, { deletionId: 'not-a-uuid' }, { alreadyCommitted: 'yes' }])('retains malformed receipts: %o', async (bad) => {
  const { owner, options, sheet } = setup();
  options.deleteRecord.mockImplementationOnce(async (_s, row, request) => ({ operationId: request.operationId, rowId: row, deletionId: request.operationId, alreadyCommitted: false, workbook: deleted(options.currentWorkbook(), row), ...bad }) as never);
  await expect(owner.start('s', sheet.content.rows[0]!, options)).rejects.toThrow('did not match');
  expect(owner.unresolved).toBe(true);
  await owner.confirmRetained(options);
});

it('retains a mismatched deletion authority and confirms the identical request with a matching authority', async () => {
  const { owner, options, sheet } = setup();
  options.deleteRecord.mockImplementationOnce(async (_s, row, request) => ({ operationId: request.operationId, rowId: row,
    deletionId: '12345678-1234-1234-1234-123456789abc', alreadyCommitted: false, workbook: deleted(options.currentWorkbook(), row) }));
  await expect(owner.start('s', sheet.content.rows[0]!, options)).rejects.toThrow('did not match');
  const request = structuredClone(options.deleteRecord.mock.calls[0]);
  expect(owner.unresolved).toBe(true);
  expect(options.reconcile).toHaveBeenCalledTimes(1);
  options.deleteRecord.mockImplementationOnce(async (_s, row, payload) => ({ operationId: payload.operationId, rowId: row,
    deletionId: payload.operationId.toUpperCase(), alreadyCommitted: true, workbook: deleted(options.currentWorkbook(), row) }));
  const result = await owner.confirmRetained(options);
  expect(options.deleteRecord.mock.calls[1]).toEqual(request);
  expect(result.deletionId.toLowerCase()).toBe(request![2].operationId.toLowerCase());
  expect(owner.unresolved).toBe(false);
  expect(options.reconcile).toHaveBeenCalledTimes(2);
});

it('retains a first-application receipt that still contains the row, but accepts a later already-committed endpoint', async () => {
  const { owner, options, sheet, before } = setup();
  options.deleteRecord.mockImplementationOnce(async (_s, row, request) => ({ operationId: request.operationId, rowId: row, deletionId: request.operationId, alreadyCommitted: false, workbook: before }));
  await expect(owner.start('s', sheet.content.rows[0]!, options)).rejects.toThrow('did not match');
  expect(owner.unresolved).toBe(true);
  expect(options.reconcile).toHaveBeenCalledTimes(1);
  options.deleteRecord.mockImplementationOnce(async (_s, row, request) => ({ operationId: request.operationId, rowId: row, deletionId: request.operationId, alreadyCommitted: true, workbook: before }));
  await owner.confirmRetained(options);
  expect(owner.unresolved).toBe(false);
});

it.each(['unbound', 'missing model', 'missing row'])('rejects %s targets before dispatch', async (target) => {
  const { owner, options, sheet, before } = setup();
  if (target === 'unbound') delete before.documents.s!.modelId;
  if (target === 'missing model') before.documents.s!.modelId = 'missing';
  const row = target === 'missing row' ? 'missing' : sheet.content.rows[0]!;
  await expect(owner.start('s', row, options)).rejects.toThrow('no longer available');
  expect(options.deleteRecord).not.toHaveBeenCalled();
  expect(owner.unresolved).toBe(false);
  expect(owner.identity).toBeUndefined();
});

it('retains stale adoption and reconciles missing sheets on confirmation', async () => {
  const { owner, options, sheet, coordinator } = setup();
  options.deleteRecord.mockImplementationOnce(async (_s, row, request) => {
    coordinator.recordRevision('s', 2);
    return { operationId: request.operationId, rowId: row, deletionId: request.operationId, alreadyCommitted: false, workbook: deleted(options.currentWorkbook(), row) };
  });
  await expect(owner.start('s', sheet.content.rows[0]!, options)).rejects.toThrow('older');
  const empty = workbookWithSheets([]); empty.manifest.revision = 2;
  options.deleteRecord.mockImplementationOnce(async (_s, row, request) => ({ operationId: request.operationId, rowId: row, deletionId: request.operationId, alreadyCommitted: true, workbook: empty }));
  await owner.confirmRetained(options);
  expect(coordinator.isSheetMissing('s')).toBe(true);
});

it('keeps pending ownership while draining and releases it after preparation failure', async () => {
  const { owner, options, sheet } = setup();
  const drain = deferred<void>(); options.waitForPredecessors.mockReturnValueOnce(drain.promise);
  const pending = owner.start('s', sheet.content.rows[0]!, options);
  await expect(owner.start('s', sheet.content.rows[0]!, options)).rejects.toThrow('Resolve');
  drain.reject(new Error('drain')); await expect(pending).rejects.toThrow('drain');
  expect(owner.unresolved).toBe(false); expect(options.deleteRecord).not.toHaveBeenCalled();
  await expect(owner.start('s', 'missing', options)).rejects.toThrow('no longer available');
});

it('retires a definite rejection only after refresh succeeds', async () => {
  const { owner, options, sheet, coordinator } = setup();
  const error = new WorkbookApiError('conflict', 409, 'sheet-revision-conflict');
  options.deleteRecord.mockRejectedValue(error);
  const recovery = { ...options, recover: (failure: unknown, refresh: () => Promise<void>) => recoverRecordReplay(failure, coordinator, refresh) };
  options.loadWorkbook.mockRejectedValueOnce(new Error('load'));
  await expect(owner.start('s', sheet.content.rows[0]!, recovery)).rejects.toThrow('load');
  options.loadWorkbook.mockResolvedValueOnce(options.currentWorkbook()).mockRejectedValueOnce(new Error('refresh'));
  await expect(owner.start('s', sheet.content.rows[0]!, recovery)).rejects.toThrow('could not be reloaded');
  expect(owner.unresolved).toBe(true);
  await expect(owner.confirmRetained(recovery)).rejects.toThrow('conflict');
  expect(owner.unresolved).toBe(false);
});

it('retains HTTP 408 and preserves ownership if a retry drain fails', async () => {
  const { owner, options, sheet, coordinator } = setup();
  options.deleteRecord.mockRejectedValueOnce(new WorkbookApiError('timeout', 408));
  const recovery = { ...options, recover: (failure: unknown, refresh: () => Promise<void>) => recoverRecordReplay(failure, coordinator, refresh) };
  await expect(owner.start('s', sheet.content.rows[0]!, recovery)).rejects.toThrow('timeout');
  const identity = owner.identity;
  options.waitForPredecessors.mockRejectedValueOnce(new Error('drain'));
  await expect(owner.confirmRetained(recovery)).rejects.toThrow('drain');
  expect(owner.identity).toEqual(identity);
  expect(owner.unresolved).toBe(true);
  await owner.confirmRetained(recovery);
});
