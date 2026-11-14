import { expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { WorkbookOutbox } from './workbookOutbox';
import { WorkbookPersistenceTransport } from './workbookPersistenceTransport';

const operationId = '76e2882d-7ff5-4b17-a7aa-512587ddf933';
const transitionId = 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4';
const workbook = workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Sheet' })]);

it('retries replay with the same operation, transition, and direction', async () => {
  const receipt = { operationId, transitionId, alreadyCommitted: true, workbook };
  const replayModelLifecycle = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(receipt);
  const admitModelLifecycle = vi.fn();
  const transport = new WorkbookPersistenceTransport({ replayModelLifecycle, admitModelLifecycle });
  const outbox = new WorkbookOutbox();
  outbox.enqueue(operationId, { kind: 'model-lifecycle', before: workbook, after: workbook, replay: { transitionId, direction: 'undo' } });
  expect((await outbox.executeNext(transport))?.status).toBe('failed');
  outbox.retry(operationId);
  expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
  expect(replayModelLifecycle).toHaveBeenCalledTimes(2);
  expect(replayModelLifecycle).toHaveBeenNthCalledWith(1, operationId, transitionId, 'undo');
  expect(replayModelLifecycle).toHaveBeenNthCalledWith(2, operationId, transitionId, 'undo');
  expect(admitModelLifecycle).not.toHaveBeenCalled();
  expect(outbox.inspect(operationId)?.receipt).toEqual(receipt);
});

it.each([
  { ...workbook, manifest: { ...workbook.manifest, revision: -1 } },
  { ...workbook, documents: {} },
  { ...workbook, documents: { sheet: { ...workbook.documents.sheet!, revision: -1 } } },
  { ...workbook, documents: { sheet: { id: 'sheet', revision: 0 } } },
  { ...workbook, functions: [{ name: 'broken', parameters: 'invalid', body: '1' }] },
  { ...workbook, dataModels: { model: { id: 'model', name: 'Model', columns: 'invalid' } } },
])('rejects typed-client receipts with inconsistent workbook state', async (invalid) => {
  const admitModelLifecycle = vi.fn().mockResolvedValue({ operationId, transitionId, alreadyCommitted: false, workbook: invalid });
  const transport = new WorkbookPersistenceTransport({ admitModelLifecycle });
  await expect(transport.execute({ operationId, intent: { kind: 'model-lifecycle', before: workbook, after: workbook }, affectedSheetIds: ['sheet'] })).rejects.toThrow('Invalid lifecycle receipt.');
  const outbox = new WorkbookOutbox();
  outbox.enqueue(operationId, { kind: 'model-lifecycle', before: workbook, after: workbook });
  expect((await outbox.executeNext(transport))?.status).toBe('failed');
  expect(outbox.inspect(operationId)?.receipt).toBeUndefined();
});
