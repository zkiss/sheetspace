import { describe, expect, it, vi } from 'vitest';
import type { SheetDocument } from '@workbook/core/model';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { admitEntryRecord } from './admitEntryRecord';
import type { EntrySubmission } from './modelEntrySession';

describe('record admission serialization', () => {
  it('captures the revision after preceding writes and retains it on retry', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    let release!: () => void;
    const preceding = coordinator.serialize(['s'], async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      coordinator.recordRevision('s', 4);
    });
    const submission: EntrySubmission = { rowId: 'id', values: { n: '12' } };
    const sheet = { id: 's', revision: 1 } as SheetDocument;
    const saved = { ...sheet, revision: 5 };
    const admit = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ rowId: 'id', sheet: saved });
    const reconcile = vi.fn();
    const options = { sheetId: 's', submission, coordinator, waitForPredecessors: async () => {}, currentSheet: () => sheet, admit, reconcile };
    const first = admitEntryRecord(options);
    expect(admit).not.toHaveBeenCalled();
    release();
    await preceding;
    await expect(first).rejects.toThrow('lost response');
    expect(reconcile).not.toHaveBeenCalled();
    coordinator.recordRevision('s', 9);
    await admitEntryRecord(options);
    expect(admit.mock.calls).toEqual([['s', 'id', { n: '12' }, 4], ['s', 'id', { n: '12' }, 4]]);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith(saved);
  });

  it('does not reconcile an unexpected response or a removed sheet', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    const sheet = { id: 's', revision: 1 } as SheetDocument;
    const reconcile = vi.fn();
    const options = { sheetId: 's', submission: { rowId: 'id', values: {} }, coordinator, waitForPredecessors: async () => {}, currentSheet: () => sheet, admit: vi.fn().mockResolvedValue({ rowId: 'other', sheet }), reconcile };
    await expect(admitEntryRecord(options)).rejects.toThrow('did not match');
    coordinator.confirmSheetMissing('s');
    await expect(admitEntryRecord(options)).rejects.toThrow('no longer available');
    expect(reconcile).not.toHaveBeenCalled();
  });
});
