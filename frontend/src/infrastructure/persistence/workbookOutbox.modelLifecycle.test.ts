import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@test-support/apiClients';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { WorkbookOutbox, type TransportResult } from './workbookOutbox';
import { WorkbookPersistenceTransport } from './workbookPersistenceTransport';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';

function boundary(outbox: WorkbookOutbox) {
  const workbook = workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]);
  outbox.enqueue('boundary', { kind: 'model-lifecycle', before: workbook, after: workbook });
  return workbook;
}

describe('structural persistence barriers', () => {
  it('reserves the union of created and removed sheet identities', () => {
    const outbox = new WorkbookOutbox();
    const before = workbookWithSheets([sheetDocument({ id: 'old', name: 'Old' })]);
    const after = workbookWithSheets([sheetDocument({ id: 'new', name: 'New' })]);
    const entry = outbox.enqueue('transition', { kind: 'model-lifecycle', before, after });
    expect(entry.affectedSheetIds).toEqual(['old', 'new']);
  });

  it('allows recreation after a snapshot removal and replaces the prior revision', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    const original = workbookWithSheets([sheetDocument({ id: 'one', name: 'One', revision: 9 })]);
    const empty = workbookWithSheets([]);
    const recreated = workbookWithSheets([sheetDocument({ id: 'one', name: 'One', revision: 0 })]);
    const saveModelLifecycle = vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(recreated);
    const transport = new WorkbookPersistenceTransport({ saveModelLifecycle }, coordinator);
    coordinator.recordRevision('one', 9);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('undo', { kind: 'model-lifecycle', before: original, after: empty });
    await outbox.executeNext(transport);
    expect(coordinator.isSheetMissing('one')).toBe(true);
    outbox.enqueue('redo', { kind: 'model-lifecycle', before: empty, after: recreated });
    await outbox.executeNext(transport);
    expect(outbox.inspect('redo')!.status).toBe('succeeded');
    expect(coordinator.isSheetMissing('one')).toBe(false);
    expect(coordinator.revision('one')).toBe(0);
  });

  it('preserves pre-boundary writes and frame coalescing when a later deletion supersedes newer work', () => {
    const outbox = new WorkbookOutbox();
    outbox.enqueue('old-frame', { kind: 'update-sheet-position', sheetId: 'one', position: { x: 1, y: 2 } });
    outbox.enqueue('old-cell', { kind: 'write-cells', writes: [{ sheetId: 'one', rowId: 'row', columnId: 'column', beforeRaw: null, afterRaw: '3' }] });
    boundary(outbox);
    outbox.enqueue('new-frame', { kind: 'update-sheet-position', sheetId: 'one', position: { x: 3, y: 4 } });
    outbox.supersedeSheetOperations('one');

    expect(outbox.inspect('old-frame')!.status).toBe('queued');
    expect(outbox.inspect('old-cell')!.status).toBe('queued');
    expect(outbox.inspect('boundary')!.status).toBe('queued');
    expect(outbox.inspect('new-frame')!.status).toBe('superseded');
  });

  it('waits for every predecessor even when deletion has removed its sheet from the structural snapshot', async () => {
    const outbox = new WorkbookOutbox();
    const pending = deferred<TransportResult>();
    const transport = { execute: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ kind: 'saved', revisions: [] }) };
    outbox.enqueue('delete-removed', { kind: 'delete-sheet', sheetId: 'already-removed' });
    boundary(outbox);
    outbox.enqueue('later', { kind: 'rename-sheet', sheetId: 'unrelated', name: 'Later' });
    const [deletion] = outbox.executeAvailable(transport);
    expect(transport.execute).toHaveBeenCalledTimes(1);
    pending.resolve({ kind: 'saved', revisions: [] });
    await deletion;
    await outbox.executeNext(transport);
    await outbox.executeNext(transport);
    expect(transport.execute.mock.calls.map(([entry]) => entry.operationId)).toEqual(['delete-removed', 'boundary', 'later']);
  });

  it('does not let a deletion bypass a failed structural snapshot and retries the same deep-cloned data', async () => {
    const outbox = new WorkbookOutbox();
    const original = boundary(outbox);
    original.documents.one!.name = 'Not the queued name';
    const execute = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({ kind: 'saved', revisions: [] });
    await outbox.executeNext({ execute });
    outbox.supersedeSheetOperations('one');
    outbox.enqueue('delete', { kind: 'delete-sheet', sheetId: 'one' });
    expect(await outbox.executeNext({ execute })).toBeUndefined();
    outbox.retry('boundary');
    await outbox.executeNext({ execute });
    expect(execute.mock.calls[1][0]).toEqual(execute.mock.calls[0][0]);
    expect(execute.mock.calls[0][0].intent.after.documents.one.name).toBe('One');
    await outbox.executeNext({ execute });
    expect(outbox.inspect('delete')!.status).toBe('succeeded');
  });

  it('blocks the whole structural snapshot when one sheet is missing rather than marking a partial save successful', async () => {
    const outbox = new WorkbookOutbox();
    boundary(outbox);
    outbox.supersedeMissingSheetOperations('one');
    const coordinator = new WorkbookPersistenceCoordinator();
    coordinator.confirmSheetMissing('one');
    const saveModelLifecycle = vi.fn();

    const result = await outbox.executeNext(new WorkbookPersistenceTransport({ saveModelLifecycle }, coordinator));

    expect(result!.status).toBe('blocked');
    expect(saveModelLifecycle).not.toHaveBeenCalled();
  });

  it('retries an ambiguous lifecycle response with the exact original compare-and-swap', async () => {
    const before = workbookWithSheets([sheetDocument({ id: 'one', name: 'One' })]);
    const after = workbookWithSheets([sheetDocument({ id: 'one', name: 'One' }), sheetDocument({ id: 'new', name: 'New' })]);
    const saveModelLifecycle = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(after);
    const outbox = new WorkbookOutbox();
    const transport = new WorkbookPersistenceTransport({ saveModelLifecycle });
    outbox.enqueue('extract', { kind: 'model-lifecycle', before, after });

    expect((await outbox.executeNext(transport))!.status).toBe('failed');
    outbox.retry('extract');
    expect((await outbox.executeNext(transport))!.status).toBe('succeeded');
    expect(saveModelLifecycle.mock.calls).toEqual([[before, after], [before, after]]);
  });

  it('blocks a lifecycle transition behind a failed ordinary prerequisite until explicitly retried', async () => {
    const outbox = new WorkbookOutbox();
    outbox.enqueue('write', { kind: 'rename-sheet', sheetId: 'one', name: 'Changed' });
    boundary(outbox);
    const execute = vi.fn().mockRejectedValueOnce(new Error('write failed')).mockResolvedValue({ kind: 'saved', revisions: [] });

    await outbox.executeNext({ execute });
    expect(outbox.inspect('boundary')!.status).toBe('blocked');
    expect(outbox.modelTransitionIsBlockedByFailedPrerequisite('boundary')).toBe(true);
    outbox.retry('write');
    await outbox.executeNext({ execute });
    expect(await outbox.executeNext({ execute })).toBeUndefined();
    outbox.retry('boundary');
    expect((await outbox.executeNext({ execute }))!.status).toBe('succeeded');
  });
});
