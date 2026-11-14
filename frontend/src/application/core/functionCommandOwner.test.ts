import { expect, it, vi } from 'vitest';
import { FunctionCommandOwner } from './functionCommandOwner';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

const declaration = { name: 'fibonacci', parameters: [], body: '=1' };
const id = 'c0c77401-ff90-4af9-b777-29cad4315311';
function setup() {
  let current = workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 })]);
  const original = structuredClone(current);
  const coordinator = new WorkbookPersistenceCoordinator();
  const receipt = () => ({ operationId: id, committedIdentity: 'identity', alreadyCommitted: true, workbook: structuredClone(current) });
  const options = {
    coordinator, currentWorkbook: () => current, loadWorkbook: vi.fn(async () => structuredClone(current)),
    setFunction: vi.fn<(id: string, before: typeof current, declaration: import('./functionCommands').FunctionDeclaration, previousName?: string) => Promise<ReturnType<typeof receipt>>>(async () => receipt()), deleteFunction: vi.fn(async () => receipt()),
    reconcile: vi.fn((next: typeof current) => { current = next; }), definitelyRejected: () => false,
  };
  return { options, original, coordinator, change: (next: typeof current) => { current = next; } };
}

it('retains an immutable request and identity after a lost response and adopts current authority on retry', async () => {
  const { options, original } = setup();
  const owner = new FunctionCommandOwner();
  options.setFunction.mockImplementationOnce(async () => { throw new Error('lost response'); });
  await expect(owner.start({ kind: 'set', declaration }, options, id)).rejects.toThrow('lost response');
  expect(owner.unresolved).toBe(true);
  declaration.body = '=2';
  const current = structuredClone(original);
  current.functions = [];
  options.setFunction.mockResolvedValueOnce({ operationId: id, committedIdentity: 'identity', alreadyCommitted: true, workbook: current });
  await expect(owner.retry(options)).resolves.toEqual(current);
  expect(options.setFunction.mock.calls[1][0]).toBe(id);
  expect(options.setFunction.mock.calls[1][1]).toEqual(original);
  expect(options.setFunction.mock.calls[1][2].body).toBe('=1');
  expect(owner.unresolved).toBe(false);
  declaration.body = '=1';
});

it('retains malformed and stale receipts without publishing them', async () => {
  const { options, original, coordinator } = setup();
  const owner = new FunctionCommandOwner();
  options.setFunction.mockResolvedValueOnce({ operationId: 'wrong', committedIdentity: 'identity', alreadyCommitted: false, workbook: original });
  await expect(owner.start({ kind: 'set', declaration }, options, id)).rejects.toThrow('Invalid function receipt');
  coordinator.recordRevision('sheet', original.documents.sheet.revision + 1);
  await expect(owner.retry(options)).rejects.toThrow('older');
  expect(owner.unresolved).toBe(true);
  expect(options.reconcile).toHaveBeenCalledTimes(1);
});

it('revalidates against authority before dispatch and clears rejected preparation', async () => {
  const { options } = setup();
  const owner = new FunctionCommandOwner();
  await expect(owner.start({ kind: 'delete', name: 'missing' }, options, id)).rejects.toThrow('unknown-function');
  expect(options.deleteFunction).not.toHaveBeenCalled();
  expect(owner.unresolved).toBe(false);
});

it('refreshes after a definite conflict and releases authority without retrying stale intent', async () => {
  const { options } = setup();
  const owner = new FunctionCommandOwner();
  options.definitelyRejected = () => true;
  options.setFunction.mockRejectedValueOnce(new Error('conflict'));
  await expect(owner.start({ kind: 'set', declaration }, options, id)).rejects.toThrow('conflict');
  expect(options.loadWorkbook).toHaveBeenCalledTimes(2);
  expect(owner.unresolved).toBe(false);
  expect(() => owner.retry(options)).toThrow('No unresolved');
});

it('only reconciles a rejected operation after refresh fails, even if its precondition is restored', async () => {
  const { options, original, change } = setup();
  const owner = new FunctionCommandOwner();
  options.definitelyRejected = () => true;
  options.loadWorkbook.mockResolvedValueOnce(options.currentWorkbook()).mockRejectedValueOnce(new Error('no refresh'));
  options.setFunction.mockRejectedValueOnce(new Error('conflict'));
  await expect(owner.start({ kind: 'set', declaration }, options, id)).rejects.toThrow('no refresh');
  expect(owner.unresolved).toBe(true);
  expect(owner.phase).toBe('rejected-awaiting-reconciliation');
  change(structuredClone(original));
  await expect(owner.retry(options)).rejects.toThrow('conflict');
  expect(options.setFunction).toHaveBeenCalledTimes(1);
  expect(options.reconcile).toHaveBeenLastCalledWith(original);
  expect(owner.unresolved).toBe(false);
  expect(owner.phase).toBe('rejected');
});

it('adopts current authority after a duplicate receipt even when the function was renamed remotely', async () => {
  const { options, original, coordinator } = setup();
  const owner = new FunctionCommandOwner();
  options.setFunction.mockRejectedValueOnce(new Error('lost response'));
  await expect(owner.start({ kind: 'set', declaration }, options, id)).rejects.toThrow('lost response');
  const current = structuredClone(original);
  current.documents.sheet.revision = 4;
  current.functions = [{ name: 'renamed', parameters: [], body: '=9', identity: 'remote' }];
  options.setFunction.mockResolvedValueOnce({ operationId: id, committedIdentity: 'identity', alreadyCommitted: true, workbook: current });
  await expect(owner.retry(options)).resolves.toEqual(current);
  expect(options.reconcile).toHaveBeenLastCalledWith(current);
  expect(coordinator.revision('sheet')).toBe(4);
});
