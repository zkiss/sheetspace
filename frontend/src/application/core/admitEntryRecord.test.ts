import { describe, expect, it, vi } from 'vitest';
import type { Workbook } from '@workbook/core/model';
import { WorkbookPersistenceCoordinator } from '@infrastructure/persistence/workbookPersistenceCoordinator';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { deferred } from '@test-support/apiClients';
import { admitEntryRecord } from './admitEntryRecord';
import type { EntrySubmission } from './modelEntrySession';

function setup() {
  const first = sheetDocument({ id: 'first', name: 'First', rowCount: 1, columnCount: 1 });
  const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 2, columnCount: 1 });
  const unchanged = sheetDocument({ id: 'unchanged', name: 'Unchanged', rowCount: 1, columnCount: 1 });
  const before = workbookWithSheets([first, second, unchanged]);
  const saved = workbookWithSheets([
    { ...first, revision: 1, content: { ...first.content, rows: ['new', ...first.content.rows] } },
    { ...second, revision: 1, content: { ...second.content, rows: [...second.content.rows].reverse() } },
    unchanged,
  ]);
  let current = before;
  const coordinator = new WorkbookPersistenceCoordinator();
  const submission: EntrySubmission = { rowId: 'new', values: { input: '12' } };
  const reconcile = vi.fn((workbook: Workbook) => { current = workbook; });
  const options = {
    sheetId: 'first', submission, coordinator, waitForPredecessors: vi.fn(async () => {}),
    currentWorkbook: () => current, loadWorkbook: vi.fn(async () => before),
    prepare: vi.fn(() => [saved.documents.first!, saved.documents.second!].map((sheet) => ({ sheetId: sheet.id, order: sheet.content.rows }))),
    admit: vi.fn().mockResolvedValue({ rowId: 'new', alreadyCommitted: false, workbook: saved }), reconcile,
  };
  return { before, saved, options, coordinator, submission, reconcile };
}

describe('atomic admission', () => {
  it('captures after all predecessors and adopts complete authoritative state and revisions', async () => {
    const { options, saved, coordinator } = setup();
    const drain = deferred<void>();
    options.waitForPredecessors.mockReturnValue(drain.promise);
    const pending = admitEntryRecord(options);
    expect(options.loadWorkbook).not.toHaveBeenCalled();
    drain.resolve();
    await pending;
    expect(options.admit).toHaveBeenCalledWith('first', expect.objectContaining({ rowOrders: options.prepare.mock.results[0]!.value }));
    expect(options.currentWorkbook()).toEqual(saved);
    expect(coordinator.revision('first')).toBe(1);
    expect(coordinator.revision('second')).toBe(1);
    expect(coordinator.revision('unchanged')).toBe(0);
  });

  it('freezes the payload once and confirms current state after a lost response and later deletions', async () => {
    const { options, before, submission, coordinator } = setup();
    options.admit.mockRejectedValueOnce(new Error('lost response'));
    await expect(admitEntryRecord(options)).rejects.toThrow('lost response');
    const frozen = structuredClone(submission.request);
    before.documents.second!.name = 'Mutated source';
    options.prepare.mock.results[0]!.value[0]!.order.reverse();
    const current = workbookWithSheets([sheetDocument({ id: 'third', name: 'Third' })]);
    current.manifest.revision = 2;
    current.dataModels = { model: { id: 'model', name: 'New model', columns: [] } };
    options.admit.mockResolvedValue({ rowId: 'new', alreadyCommitted: true, workbook: current });
    expect(await admitEntryRecord(options)).toEqual({ rowId: 'new', sheet: undefined });
    expect(options.admit.mock.calls[0]).toEqual(options.admit.mock.calls[1]);
    expect(submission.request).toEqual(frozen);
    expect(options.prepare).toHaveBeenCalledOnce();
    expect(options.loadWorkbook).toHaveBeenCalledOnce();
    expect(options.currentWorkbook()).toEqual(current);
    expect(coordinator.isSheetMissing('first')).toBe(true);
    expect(coordinator.revision('third')).toBe(0);
  });

  it('does not capture or dispatch when a predecessor failed', async () => {
    const { options } = setup();
    options.waitForPredecessors.mockRejectedValue(new Error('failed save'));
    await expect(admitEntryRecord(options)).rejects.toThrow('failed save');
    expect(options.admit).not.toHaveBeenCalled();
  });

  it.each([
    { rowId: 'other', alreadyCommitted: true },
    { rowId: 'new', alreadyCommitted: undefined },
    { rowId: 'new', alreadyCommitted: false },
  ])('retains the request without adopting an ambiguous confirmation %j', async (response) => {
    const { options, before, submission } = setup();
    options.admit.mockResolvedValue({ ...response, workbook: before });
    await expect(admitEntryRecord(options)).rejects.toThrow('did not match');
    expect(submission.request).toBeDefined();
    expect(options.reconcile).toHaveBeenCalledTimes(1);
  });

  it('rejects stale snapshots as a whole instead of mixing old metadata with new sheets', async () => {
    const { options, coordinator, before, saved } = setup();
    options.admit.mockImplementation(async () => {
      coordinator.recordRevision('second', 3);
      return { rowId: 'new', alreadyCommitted: false, workbook: saved };
    });
    await expect(admitEntryRecord(options)).rejects.toThrow('older');
    expect(options.currentWorkbook()).toEqual(before);
    expect(coordinator.revision('second')).toBe(3);
  });

  it('does not dispatch for a removed initial target or an old manifest', async () => {
    const { options, before } = setup();
    options.loadWorkbook.mockResolvedValue(workbookWithSheets([]));
    await expect(admitEntryRecord(options)).rejects.toThrow('no longer available');
    before.manifest.revision = 2;
    options.reconcile(before);
    await expect(admitEntryRecord(options)).rejects.toThrow('older');
    expect(options.admit).not.toHaveBeenCalled();
  });

  it('uses ordinary tail admission without guessing sorting when prepare is absent', async () => {
    const { options, submission } = setup();
    await admitEntryRecord({ ...options, prepare: undefined });
    expect(submission.request!.rowOrders).toEqual([]);
  });
});
