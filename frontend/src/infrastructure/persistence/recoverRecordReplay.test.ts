import { expect, it, vi } from 'vitest';
import { WorkbookApiError } from './workbookApi';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';
import { recoverRecordReplay } from './recoverRecordReplay';

it.each([
  [400, 'invalid-model-record', {}],
  [404, 'sheet-not-found', { sheetId: 'dependency' }],
  [409, 'sheet-revision-conflict', { sheetId: 'dependency', expectedRevision: 1, actualRevision: 2 }],
  [409, 'model-lifecycle-conflict', { scope: 'workbook' }],
])('refreshes before returning definite rejection %s %s', async (status, code, context) => {
  const error = new WorkbookApiError('rejected', status, code, context);
  const coordinator = new WorkbookPersistenceCoordinator();
  const refresh = vi.fn();
  await expect(recoverRecordReplay(error, coordinator, refresh)).rejects.toBe(error);
  expect(refresh).toHaveBeenCalledOnce();
  expect(coordinator.isSheetMissing('dependency')).toBe(status === 404);
});

it('preserves ambiguity on refresh failure and network failure', async () => {
  const coordinator = new WorkbookPersistenceCoordinator();
  const missing = new WorkbookApiError('missing', 404, 'sheet-not-found', { sheetId: 'dependency' });
  await expect(recoverRecordReplay(missing, coordinator, vi.fn().mockRejectedValue(new Error('offline')))).rejects.toThrow('could not be reloaded');
  expect(coordinator.isSheetMissing('dependency')).toBe(false);
  const offline = new Error('offline');
  const refresh = vi.fn();
  await expect(recoverRecordReplay(offline, coordinator, refresh)).rejects.toBe(offline);
  expect(refresh).not.toHaveBeenCalled();
});
