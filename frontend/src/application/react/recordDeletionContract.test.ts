import { expect, it } from 'vitest';
import { deletionFixture } from '@test-support/recordDeletionFixture';

it('deduplicates deletion replay before checking stale source, but rejects changed fingerprints and wrong endpoints', async () => {
  const { api, initial, rowId } = deletionFixture();
  const capture = { operationId: 'delete', before: initial, rowOrders: [] };
  const deletion = await api.deleteRecord('sheet', rowId, capture);
  const undo = { operationId: 'undo', before: deletion.workbook, direction: 'undo' as const };
  const restored = await api.replayRecordDeletion('sheet', rowId, deletion.deletionId, undo);
  const duplicate = await api.replayRecordDeletion('sheet', rowId, deletion.deletionId, structuredClone(undo));
  expect(duplicate).toEqual({ ...restored, alreadyCommitted: true });
  expect(await api.loadWorkbook()).toEqual(restored.workbook);
  await expect(api.replayRecordDeletion('sheet', rowId, deletion.deletionId, { ...undo, direction: 'redo' })).rejects.toThrow();
  await expect(api.replayRecordDeletion('sheet', rowId, deletion.deletionId, { ...undo, operationId: 'wrong-source', before: restored.workbook })).rejects.toThrow();
  await expect(api.replayRecordDeletion('sheet', rowId, deletion.deletionId, { ...undo, operationId: 'stale' })).rejects.toThrow();
  await expect(api.deleteRecord('sheet', rowId, { ...capture, rowOrders: [{ sheetId: 'sheet', order: [] }] })).rejects.toThrow();
  expect(await api.loadWorkbook()).toEqual(restored.workbook);
});
