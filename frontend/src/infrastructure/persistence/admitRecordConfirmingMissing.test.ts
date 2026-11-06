import { describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { EntryAdmissionRejected } from '@application/core/modelEntrySession';
import { admitRecordConfirmingMissing } from './admitRecordConfirmingMissing';
import { WorkbookApiError } from './workbookApi';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';

describe('admission dependency errors', () => {
  it('reloads and reconciles the conflicting dependency rather than the admitted sheet', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    const other = sheetDocument({ id: 'other', name: 'Other', rowCount: 1, columnCount: 1 });
    const reload = vi.fn().mockResolvedValue(other);
    const reconcile = vi.fn();
    const admit = vi.fn().mockRejectedValue(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict', { sheetId: 'other' }));

    await expect(admitRecordConfirmingMissing(admit, coordinator, reload, reconcile)('target', 'row', {}, 0)).rejects.toBeInstanceOf(EntryAdmissionRejected);

    expect(reload).toHaveBeenCalledWith('other');
    expect(reconcile).toHaveBeenCalledWith(other);
    expect(coordinator.revision('other')).toBe(other.revision);
    expect(coordinator.revision('target')).toBeUndefined();
  });

  it('marks only the reported missing dependency as missing', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    const admit = vi.fn().mockRejectedValue(new WorkbookApiError('missing', 404, 'sheet-not-found', { sheetId: 'other' }));

    await expect(admitRecordConfirmingMissing(admit, coordinator, vi.fn(), vi.fn())('target', 'row', {}, 0)).rejects.toThrow('missing');

    expect(coordinator.isSheetMissing('other')).toBe(true);
    expect(coordinator.isSheetMissing('target')).toBe(false);
  });
});
