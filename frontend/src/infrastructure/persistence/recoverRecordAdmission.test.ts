import { describe, expect, it, vi } from 'vitest';
import { EntryAdmissionRejected } from '@application/core/modelEntrySession';
import { recoverRecordAdmission } from './recoverRecordAdmission';
import { WorkbookApiError } from './workbookApi';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';

describe('admission error recovery within the workbook fence', () => {
  it.each([
    ['sheet-revision-conflict', { sheetId: 'other' }],
    ['model-lifecycle-conflict', { scope: 'workbook' }],
  ])('refreshes the full workbook for %s before permitting correction', async (code, context) => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    await expect(recoverRecordAdmission(new WorkbookApiError('conflict', 409, code, context), 'target', new WorkbookPersistenceCoordinator(), refresh)).rejects.toBeInstanceOf(EntryAdmissionRejected);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each(['other', undefined])('marks the actual missing sheet %s', async (sheetId) => {
    const coordinator = new WorkbookPersistenceCoordinator();
    const error = new WorkbookApiError('missing', 404, 'sheet-not-found', { sheetId });
    const refresh = vi.fn().mockResolvedValue(undefined);
    await expect(recoverRecordAdmission(error, 'target', coordinator, refresh)).rejects.toBeInstanceOf(EntryAdmissionRejected);
    expect(refresh).toHaveBeenCalledOnce();
    expect(coordinator.isSheetMissing(sheetId ?? 'target')).toBe(true);
    if (sheetId) expect(coordinator.isSheetMissing('target')).toBe(false);
  });

  it('permits correction for validation but retains ambiguity for network and failed refresh', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    await expect(recoverRecordAdmission(new WorkbookApiError('invalid', 400, 'invalid-model-record'), 's', coordinator, vi.fn())).rejects.toBeInstanceOf(EntryAdmissionRejected);
    const network = new Error('offline');
    await expect(recoverRecordAdmission(network, 's', coordinator, vi.fn())).rejects.toBe(network);
    await expect(recoverRecordAdmission(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'), 's', coordinator, vi.fn().mockRejectedValue(network))).rejects.toThrow('could not be reloaded');
    await expect(recoverRecordAdmission(new WorkbookApiError('missing', 404, 'sheet-not-found', { sheetId: 'other' }), 's', coordinator, vi.fn().mockRejectedValue(network))).rejects.toThrow('could not be reloaded');
    expect(coordinator.isSheetMissing('other')).toBe(false);
  });

  it.each([408, 500])('preserves an ambiguous HTTP %s without refreshing or permitting correction', async (status) => {
    const error = new WorkbookApiError('uncertain', status);
    const refresh = vi.fn();
    await expect(recoverRecordAdmission(error, 's', new WorkbookPersistenceCoordinator(), refresh)).rejects.toBe(error);
    expect(refresh).not.toHaveBeenCalled();
  });
});
