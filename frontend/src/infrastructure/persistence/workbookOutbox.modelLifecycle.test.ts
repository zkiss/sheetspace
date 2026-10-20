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
});
