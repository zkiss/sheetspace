import { describe, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';
import { coordinateAtomicAdmission } from './atomicAdmissionCoordinator';

describe('atomic admission coordination', () => {
  it('freezes the complete request after predecessors and retries it unchanged while recording all revisions', async () => {
    const first = sheetDocument({ id: 'first', name: 'First', rowCount: 1, columnCount: 1 });
    const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 2, columnCount: 1 });
    const before = workbookWithSheets([first, second]);
    const coordinator = new WorkbookPersistenceCoordinator();
    const submission = {};
    const prepare = vi.fn((workbook) => ({ rowId: 'new', values: { input: '12' }, revision: first.revision, before: workbook, rowOrders: [{ sheetId: 'second', order: [...second.content.rows].reverse() }] }));
    const saved = workbookWithSheets([{ ...first, revision: first.revision + 1 }, { ...second, revision: second.revision + 1 }]);
    const admit = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ rowId: 'new', alreadyCommitted: true, workbook: saved });
    const reconcile = vi.fn();
    const options = { sheetId: 'first', submission, coordinator, waitForPredecessors: async () => {}, currentWorkbook: () => before, prepare, admit, reconcile };

    await expect(coordinateAtomicAdmission(options)).rejects.toThrow('lost response');
    await coordinateAtomicAdmission(options);

    expect(prepare).toHaveBeenCalledOnce();
    expect(admit.mock.calls[0]).toEqual(admit.mock.calls[1]);
    expect(coordinator.revision('first')).toBe(first.revision + 1);
    expect(coordinator.revision('second')).toBe(second.revision + 1);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('does not reconcile a response older than a known local revision', async () => {
    const sheet = sheetDocument({ id: 'first', name: 'First', rowCount: 1, columnCount: 1 });
    const before = workbookWithSheets([sheet]);
    const coordinator = new WorkbookPersistenceCoordinator();
    coordinator.recordRevision('first', sheet.revision + 3);
    const reconcile = vi.fn();
    await coordinateAtomicAdmission({
      sheetId: 'first', submission: {}, coordinator, waitForPredecessors: async () => {}, currentWorkbook: () => before,
      prepare: () => ({ rowId: 'new', values: {}, revision: sheet.revision, before, rowOrders: [] }),
      admit: async () => ({ rowId: 'new', alreadyCommitted: true, workbook: before }), reconcile,
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(coordinator.revision('first')).toBe(sheet.revision + 3);
  });
});
