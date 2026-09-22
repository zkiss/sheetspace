import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@test-support/apiClients';
import { WorkbookApiError, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import { WorkbookOutbox } from '@infrastructure/persistence/workbookOutbox';
import { WorkbookPersistenceTransport } from '@infrastructure/persistence/workbookPersistenceTransport';
import { sheetDocument } from '@test-support/workbookFactories';

const rename = (sheetId: string, name: string) => ({ kind: 'rename-sheet', sheetId, name } as const);

describe('WorkbookOutbox', () => {
  it('orders dependent work while allowing independent sheets to progress', async () => {
    const first = deferred<void>(); const calls: string[] = [];
    const transport = { execute: vi.fn(async (entry) => { calls.push(entry.intent.kind === 'rename-sheet' ? entry.intent.name : ''); if (entry.intent.kind === 'rename-sheet' && entry.intent.name === 'first') await first.promise; return { kind: 'saved', revisions: [] } as const; }) };
    const outbox = new WorkbookOutbox(); outbox.enqueue('1', rename('a', 'first')); outbox.enqueue('2', rename('a', 'second')); outbox.enqueue('3', rename('b', 'other'));
    const running = outbox.executeNext(transport); await outbox.executeNext(transport);
    expect(calls).toEqual(['first', 'other']); first.resolve(); await running; await outbox.executeNext(transport); expect(calls).toEqual(['first', 'other', 'second']);
  });
  it('treats z-order operations as dependencies of every affected sheet', async () => {
    const outbox = new WorkbookOutbox(); const calls: string[] = [];
    outbox.enqueue('z', { kind: 'update-sheet-z-order', updates: [{ sheetId: 'a', zIndex: 2 }, { sheetId: 'b', zIndex: 1 }] }); outbox.enqueue('a', rename('a', 'after'));
    await outbox.executeNext({ execute: async (entry) => { calls.push(entry.intent.kind); return { kind: 'saved', revisions: [] }; } }); await outbox.executeNext({ execute: async (entry) => { calls.push(entry.intent.kind); return { kind: 'saved', revisions: [] }; } }); expect(calls).toEqual(['update-sheet-z-order', 'rename-sheet']);
  });
  it('coalesces moves separately from layout work and preserves retry payload identity', async () => {
    const outbox = new WorkbookOutbox(); outbox.enqueue('resize', { kind: 'update-sheet-frame-layout', sheetId: 'a', position: { x: 1, y: 1 }, size: { width: 2, height: 2 } }); outbox.enqueue('move-1', { kind: 'update-sheet-position', sheetId: 'a', position: { x: 3, y: 3 } }); outbox.enqueue('move-2', { kind: 'update-sheet-position', sheetId: 'a', position: { x: 4, y: 4 } });
    expect(outbox.inspect('resize')?.status).toBe('queued'); expect(outbox.inspect('move-1')?.status).toBe('superseded');
    await outbox.executeNext({ execute: async () => { throw new Error('offline'); } }); expect(outbox.inspect('resize')?.status).toBe('failed'); outbox.retry('resize'); expect(outbox.inspect('resize')?.operationId).toBe('resize');
  });
  it('retains an in-flight resize and only the latest queued layout payload', async () => {
    const firstRequest = deferred<void>();
    const outbox = new WorkbookOutbox();
    const layouts: Array<{ x: number; width: number }> = [];
    const transport = {
      execute: vi.fn(async (entry) => {
        if (entry.intent.kind !== 'update-sheet-frame-layout') throw new Error('Unexpected intent.');
        layouts.push({ x: entry.intent.position.x, width: entry.intent.size.width });
        if (layouts.length === 1) await firstRequest.promise;
        return { kind: 'saved', revisions: [] } as const;
      }),
    };
    const resize = (x: number, width: number) => ({
      kind: 'update-sheet-frame-layout' as const,
      sheetId: 'a',
      position: { x, y: 1 },
      size: { width, height: 2 },
    });

    outbox.enqueue('resize-1', resize(1, 10));
    const running = outbox.executeNext(transport);
    outbox.enqueue('resize-2', resize(2, 20));
    outbox.enqueue('resize-3', resize(3, 30));

    expect(outbox.inspect('resize-1')?.status).toBe('superseded');
    expect(outbox.inspect('resize-2')?.status).toBe('superseded');
    expect(outbox.inspect('resize-3')?.status).toBe('queued');
    expect(await outbox.executeNext(transport)).toBeUndefined();
    firstRequest.resolve();
    await running;
    await outbox.executeNext(transport);

    expect(layouts).toEqual([{ x: 1, width: 10 }, { x: 3, width: 30 }]);
  });
  it('supersedes a failed resize with its latest replacement', async () => {
    const outbox = new WorkbookOutbox();
    const oldLayout = {
      kind: 'update-sheet-frame-layout' as const,
      sheetId: 'a',
      position: { x: 1, y: 1 },
      size: { width: 10, height: 10 },
    };
    outbox.enqueue('old-resize', oldLayout);
    await outbox.executeNext({ execute: async () => { throw new Error('offline'); } });
    const failure = outbox.inspect('old-resize')?.failure;

    outbox.enqueue('new-resize', {
      ...oldLayout,
      position: { x: 2, y: 2 },
      size: { width: 20, height: 20 },
    });

    expect(outbox.inspect('old-resize')).toMatchObject({ status: 'superseded', failure });
    expect(outbox.inspect('new-resize')?.status).toBe('queued');
  });
  it('waits for a superseded in-flight move before sending its replacement', async () => {
    const request = deferred<void>(); const outbox = new WorkbookOutbox(); const calls: string[] = [];
    outbox.enqueue('old', { kind: 'update-sheet-position', sheetId: 'a', position: { x: 1, y: 1 } });
    const running = outbox.executeNext({ execute: async () => { calls.push('old'); await request.promise; return { kind: 'saved', revisions: [] }; } });
    outbox.enqueue('new', { kind: 'update-sheet-position', sheetId: 'a', position: { x: 2, y: 2 } });
    expect(await outbox.executeNext({ execute: async () => { calls.push('new'); return { kind: 'saved', revisions: [] }; } })).toBeUndefined();
    request.resolve(); await running; await outbox.executeNext({ execute: async () => { calls.push('new'); return { kind: 'saved', revisions: [] }; } }); expect(calls).toEqual(['old', 'new']);
  });
  it('supersedes a failed move so its newer replacement can run', async () => {
    const outbox = new WorkbookOutbox(); const calls: string[] = [];
    outbox.enqueue('old', { kind: 'update-sheet-position', sheetId: 'a', position: { x: 1, y: 1 } });
    await outbox.executeNext({ execute: async () => { throw new Error('offline'); } });
    const failure = outbox.inspect('old')?.failure;
    outbox.enqueue('new', { kind: 'update-sheet-position', sheetId: 'a', position: { x: 2, y: 2 } });
    expect(outbox.inspect('old')).toMatchObject({ status: 'superseded', failure });
    await outbox.executeNext({ execute: async (entry) => { calls.push(entry.intent.kind === 'update-sheet-position' ? String(entry.intent.position.x) : 'unexpected'); return { kind: 'saved', revisions: [] }; } });
    expect(calls).toEqual(['2']);
  });
  it('retries the immutable original payload and retains its last failure until success', async () => {
    const outbox = new WorkbookOutbox();
    const intent = { kind: 'update-sheet-position' as const, sheetId: 'a', position: { x: 1, y: 2 } };
    const failure = new Error('offline');
    outbox.enqueue('move', intent);
    await outbox.executeNext({ execute: async () => { throw failure; } });

    intent.position.x = 99;
    const inspected = outbox.inspect('move')!;
    const snapshotted = outbox.snapshot()[0];
    inspected.intent.kind === 'update-sheet-position' && (inspected.intent.position.y = 88);
    snapshotted.intent.kind === 'update-sheet-position' && (snapshotted.intent.position.x = 77);

    outbox.retry('move');
    expect(outbox.inspect('move')).toMatchObject({ status: 'queued', failure });
    const execute = vi.fn(async () => ({ kind: 'saved', revisions: [] } as const));
    await outbox.executeNext({ execute });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ intent: { kind: 'update-sheet-position', sheetId: 'a', position: { x: 1, y: 2 } } }));
    expect(outbox.inspect('move')).toMatchObject({ status: 'succeeded', failure: undefined });
  });
  it('clones every cell transition at enqueue, snapshot, and transport boundaries', async () => {
    const outbox = new WorkbookOutbox();
    const intent = { kind: 'write-cells' as const, writes: [{ sheetId: 'a', rowId: 'r', columnId: 'c', beforeRaw: ' before ', afterRaw: '=a1' }] };
    outbox.enqueue('cell', intent);
    intent.writes[0].beforeRaw = 'mutated source';
    intent.writes[0].afterRaw = 'mutated source';
    const snapshot = outbox.snapshot()[0]!;
    if (snapshot.intent.kind === 'write-cells') snapshot.intent.writes[0].afterRaw = 'mutated snapshot';

    let delivered: unknown;
    const execute = vi.fn(async (entry) => {
      delivered = structuredClone(entry.intent);
      if (entry.intent.kind === 'write-cells') entry.intent.writes[0].beforeRaw = 'mutated transport';
      return { kind: 'saved', revisions: [] } as const;
    });
    await outbox.executeNext({ execute });

    expect(delivered).toEqual({
      kind: 'write-cells', writes: [{ sheetId: 'a', rowId: 'r', columnId: 'c', beforeRaw: ' before ', afterRaw: '=a1' }],
    });
    expect(outbox.inspect('cell')?.intent).toEqual({
      kind: 'write-cells', writes: [{ sheetId: 'a', rowId: 'r', columnId: 'c', beforeRaw: ' before ', afterRaw: '=a1' }],
    });
  });
  it('holds inverse cell writes behind a failed predecessor and retries its original identity', async () => {
    const outbox = new WorkbookOutbox();
    const original = { kind: 'write-cells' as const, writes: [{ sheetId: 'a', rowId: 'r', columnId: 'c', beforeRaw: null, afterRaw: '7' }] };
    const inverse = { kind: 'write-cells' as const, writes: [{ sheetId: 'a', rowId: 'r', columnId: 'c', beforeRaw: '7', afterRaw: null }] };
    const sent: string[] = [];
    outbox.enqueue('original', original);
    outbox.enqueue('undo', inverse);

    await outbox.executeNext({ execute: async (entry) => { sent.push(entry.operationId); throw new Error('offline'); } });
    expect(outbox.inspect('original')).toMatchObject({ operationId: 'original', status: 'failed' });
    expect(await outbox.executeNext({ execute: async (entry) => { sent.push(entry.operationId); return { kind: 'saved', revisions: [] }; } })).toBeUndefined();

    outbox.retry('original');
    await outbox.executeNext({ execute: async (entry) => { sent.push(entry.operationId); return { kind: 'saved', revisions: [] }; } });
    await outbox.executeNext({ execute: async (entry) => { sent.push(entry.operationId); return { kind: 'saved', revisions: [] }; } });

    expect(sent).toEqual(['original', 'original', 'undo']);
    expect(outbox.inspect('undo')?.intent).toEqual(inverse);
  });
  it('does not expose a failed entry returned by executeNext for mutation', async () => {
    const outbox = new WorkbookOutbox();
    outbox.enqueue('move', { kind: 'update-sheet-position', sheetId: 'a', position: { x: 1, y: 2 } });
    const returned = await outbox.executeNext({ execute: async () => { throw new Error('offline'); } });

    expect(returned).toMatchObject({ status: 'failed' });
    returned!.status = 'succeeded';
    returned!.affectedSheetIds = ['other'];
    if (returned!.intent.kind === 'update-sheet-position') returned!.intent.position.x = 99;

    expect(outbox.inspect('move')).toMatchObject({ status: 'failed', affectedSheetIds: ['a'] });
    outbox.retry('move');
    const execute = vi.fn(async () => ({ kind: 'saved', revisions: [] } as const));
    await outbox.executeNext({ execute });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ intent: { kind: 'update-sheet-position', sheetId: 'a', position: { x: 1, y: 2 } } }));
  });
});

describe('WorkbookPersistenceTransport', () => {
  it('reloads on conflict and records the retry revision', async () => {
    const renameSheet = vi.fn().mockRejectedValueOnce(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict')).mockResolvedValueOnce({ sheetId: 'a', revision: 8 });
    const transport = new WorkbookPersistenceTransport({ renameSheet, loadSheet: vi.fn().mockResolvedValue({ id: 'a', revision: 7 }) } as Partial<WorkbookApi>);
    await transport.execute({ intent: rename('a', 'new'), affectedSheetIds: ['a'] }); expect(renameSheet).toHaveBeenNthCalledWith(2, 'a', 'new', { revision: 7 }); expect(transport.revision('a')).toBe(8);
  });
  it('sends a multi-sheet atomic patch with stable identities and all expected revisions', async () => {
    const writeCells = vi.fn().mockResolvedValue({ sheets: [{ sheetId: 'a', revision: 2 }, { sheetId: 'b', revision: 4 }] });
    const transport = new WorkbookPersistenceTransport({ writeCells } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1); transport.recordRevision('b', 3);
    await expect(transport.execute({ intent: { kind: 'write-cells', writes: [
      { sheetId: 'a', rowId: 'r', columnId: 'c', beforeRaw: null, afterRaw: '1' },
      { sheetId: 'b', rowId: 'r', columnId: 'd', beforeRaw: 'old', afterRaw: null },
    ] }, affectedSheetIds: ['a', 'b'] })).resolves.toEqual({ kind: 'saved', revisions: [{ sheetId: 'a', revision: 2 }, { sheetId: 'b', revision: 4 }] });
    expect(writeCells).toHaveBeenCalledWith(
      [{ sheetId: 'a', revision: 1 }, { sheetId: 'b', revision: 3 }],
      [{ sheetId: 'a', rowId: 'r', columnId: 'c', raw: '1' }, { sheetId: 'b', rowId: 'r', columnId: 'd', raw: '' }],
    );
  });
  it('accepts a lost response only when every patched cell is present at its complete after-state', async () => {
    const sheet = sheetDocument({ id: 'a', name: 'A', revision: 2, cells: { A1: 'saved', B1: 'also saved' } });
    const writeCells = vi.fn().mockRejectedValue(new TypeError('network disconnected'));
    const transport = new WorkbookPersistenceTransport({ writeCells, loadSheet: vi.fn().mockResolvedValue(sheet) } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    await expect(transport.execute({ intent: { kind: 'write-cells', writes: [
      { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'saved' },
      { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:2', beforeRaw: null, afterRaw: 'also saved' },
    ] }, affectedSheetIds: ['a'] })).resolves.toEqual({ kind: 'saved', revisions: [{ sheetId: 'a', revision: 2 }] });
    expect(writeCells).toHaveBeenCalledTimes(1);
  });
  it('fails after one automatic retry when consecutive conflicts preserve the before-state', async () => {
    const conflict = new WorkbookApiError('conflict', 409, 'sheet-revision-conflict');
    const writeCells = vi.fn().mockRejectedValue(conflict);
    const beforeSheet = sheetDocument({ id: 'a', name: 'A', revision: 2 });
    const transport = new WorkbookPersistenceTransport({ writeCells, loadSheet: vi.fn().mockResolvedValue(beforeSheet) } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('cell', { kind: 'write-cells', writes: [
      { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
    ] });

    expect((await outbox.executeNext(transport))?.status).toBe('failed');

    expect(writeCells).toHaveBeenCalledTimes(2);
    expect(outbox.inspect('cell')?.status).toBe('failed');
  });
  it('does not replay a manually retried conflict after a remote touched-cell change', async () => {
    const failure = new WorkbookApiError('conflict', 409, 'sheet-revision-conflict');
    const writeCells = vi.fn().mockRejectedValue(failure);
    const remoteSheet = sheetDocument({ id: 'a', name: 'A', revision: 2, cells: { A1: 'remote' } });
    const transport = new WorkbookPersistenceTransport({ writeCells, loadSheet: vi.fn().mockResolvedValue(remoteSheet) } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('cell', { kind: 'write-cells', writes: [
      { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
    ] });

    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    outbox.retry('cell');
    expect((await outbox.executeNext(transport))?.status).toBe('failed');

    expect(writeCells).toHaveBeenCalledTimes(1);
    expect(outbox.inspect('cell')?.status).toBe('failed');
  });
  it('does not replay a manually retried ambiguous response without complete original state', async () => {
    const failure = new TypeError('network disconnected');
    const writeCells = vi.fn().mockRejectedValue(failure);
    const remoteSheet = sheetDocument({ id: 'a', name: 'A', revision: 2, cells: { A1: 'remote' } });
    const transport = new WorkbookPersistenceTransport({ writeCells, loadSheet: vi.fn().mockResolvedValue(remoteSheet) } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('cell', { kind: 'write-cells', writes: [
      { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
    ] });

    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    outbox.retry('cell');
    expect((await outbox.executeNext(transport))?.status).toBe('failed');

    expect(writeCells).toHaveBeenCalledTimes(1);
    expect(outbox.inspect('cell')?.status).toBe('failed');
  });
  it('keeps a failed cell write guarded when its conflict reload rejects', async () => {
    const failure = new WorkbookApiError('conflict', 409, 'sheet-revision-conflict');
    const writeCells = vi.fn().mockRejectedValue(failure);
    const loadSheet = vi.fn().mockRejectedValue(new TypeError('reload unavailable'));
    const transport = new WorkbookPersistenceTransport({ writeCells, loadSheet } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('cell', { kind: 'write-cells', writes: [
      { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
    ] });

    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    outbox.retry('cell');
    expect((await outbox.executeNext(transport))?.status).toBe('failed');

    expect(writeCells).toHaveBeenCalledTimes(1);
    expect(outbox.inspect('cell')?.status).toBe('failed');
  });
  it('keeps a cell write guarded when the conflict retry response cannot be recovered', async () => {
    const conflict = new WorkbookApiError('conflict', 409, 'sheet-revision-conflict');
    const writeCells = vi.fn().mockRejectedValueOnce(conflict).mockRejectedValueOnce(new TypeError('response lost'));
    const beforeSheet = sheetDocument({ id: 'a', name: 'A', revision: 2 });
    const remoteSheet = sheetDocument({ id: 'a', name: 'A', revision: 3, cells: { A1: 'remote' } });
    const loadSheet = vi.fn().mockResolvedValueOnce(beforeSheet).mockRejectedValueOnce(new TypeError('reload unavailable')).mockResolvedValueOnce(remoteSheet);
    const transport = new WorkbookPersistenceTransport({ writeCells, loadSheet } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('cell', { kind: 'write-cells', writes: [
      { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
    ] });

    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    outbox.retry('cell');
    expect((await outbox.executeNext(transport))?.status).toBe('failed');

    expect(writeCells).toHaveBeenCalledTimes(2);
    expect(outbox.inspect('cell')?.status).toBe('failed');
  });
  it('keeps a revalidated cell write guarded when its next response is unresolved', async () => {
    const conflict = new WorkbookApiError('conflict', 409, 'sheet-revision-conflict');
    const writeCells = vi.fn().mockRejectedValueOnce(conflict).mockRejectedValueOnce(new TypeError('response lost'));
    const beforeSheet = sheetDocument({ id: 'a', name: 'A', revision: 2 });
    const remoteSheet = sheetDocument({ id: 'a', name: 'A', revision: 3, cells: { A1: 'remote' } });
    const loadSheet = vi.fn()
      .mockResolvedValueOnce(beforeSheet)
      .mockResolvedValueOnce(beforeSheet)
      .mockRejectedValueOnce(new TypeError('reload unavailable'))
      .mockResolvedValueOnce(remoteSheet);
    const transport = new WorkbookPersistenceTransport({ writeCells, loadSheet } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('cell', { kind: 'write-cells', writes: [
      { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
    ] });

    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    outbox.retry('cell');
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    outbox.retry('cell');
    expect((await outbox.executeNext(transport))?.status).toBe('failed');

    expect(writeCells).toHaveBeenCalledTimes(2);
    expect(outbox.inspect('cell')?.status).toBe('failed');
  });
  it('persists surviving z-order updates before reporting a precisely missing sheet', async () => {
    const updateSheetZOrder = vi.fn()
      .mockRejectedValueOnce(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'))
      .mockResolvedValueOnce({
        sheets: [
          { sheetId: 'b', revision: 5 },
          { sheetId: 'c', revision: 6 },
        ],
      });
    const loadSheet = vi.fn().mockImplementation(async (sheetId: string) => {
      if (sheetId === 'a') throw new WorkbookApiError('missing', 404, 'sheet-not-found');
      return { id: sheetId, revision: sheetId === 'b' ? 3 : 4 };
    });
    const transport = new WorkbookPersistenceTransport({ updateSheetZOrder, loadSheet } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    transport.recordRevision('b', 1);
    transport.recordRevision('c', 1);

    await expect(transport.execute({
      intent: {
        kind: 'update-sheet-z-order',
        updates: [
          { sheetId: 'a', zIndex: 3 },
          { sheetId: 'b', zIndex: 1 },
          { sheetId: 'c', zIndex: 2 },
        ],
      },
      affectedSheetIds: ['a', 'b', 'c'],
    })).resolves.toEqual({
      kind: 'saved',
      revisions: [
        { sheetId: 'b', revision: 5 },
        { sheetId: 'c', revision: 6 },
      ],
      missingSheetIds: ['a'],
    });
    expect(updateSheetZOrder).toHaveBeenNthCalledWith(2, [
      { sheetId: 'b', zIndex: 1, expectedRevision: 3 },
      { sheetId: 'c', zIndex: 2, expectedRevision: 4 },
    ]);
    expect(transport.revision('b')).toBe(5);
    expect(transport.revision('c')).toBe(6);
  });
  it('does not interpret an ambiguous multi-sheet request 404 as all sheets missing', async () => {
    const failure = new WorkbookApiError('missing', 404, 'sheet-not-found');
    const transport = new WorkbookPersistenceTransport({
      updateSheetZOrder: vi.fn().mockRejectedValue(failure),
    } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    transport.recordRevision('b', 1);

    await expect(transport.execute({
      intent: { kind: 'update-sheet-z-order', updates: [{ sheetId: 'a', zIndex: 2 }, { sheetId: 'b', zIndex: 1 }] },
      affectedSheetIds: ['a', 'b'],
    })).rejects.toBe(failure);
  });

  it('maps each ordinary persistence intent to its revision-aware API request', async () => {
    const api = {
      writeAxisSizes: vi.fn().mockResolvedValue({ sheetId: 'a', revision: 2 }),
      deleteSheet: vi.fn().mockResolvedValue(undefined),
      renameSheet: vi.fn().mockResolvedValue({ sheetId: 'a', revision: 3 }),
      updateSheetPosition: vi.fn().mockResolvedValue({ sheetId: 'a', revision: 4 }),
      updateSheetFrameLayout: vi.fn().mockResolvedValue({ sheetId: 'a', revision: 5 }),
      updateSheetVisualScale: vi.fn().mockResolvedValue({ sheetId: 'a', revision: 6 }),
    } as Partial<WorkbookApi>;
    const transport = new WorkbookPersistenceTransport(api);
    transport.recordRevision('a', 1);
    const entries = [
      { intent: { kind: 'write-axis-sizes' as const, sheetId: 'a', writes: [{ axis: 'row' as const, axisId: 'r', size: 30 }] }, affectedSheetIds: ['a'] },
      { intent: { kind: 'delete-sheet' as const, sheetId: 'a' }, affectedSheetIds: ['a'] },
      { intent: rename('a', 'renamed'), affectedSheetIds: ['a'] },
      { intent: { kind: 'update-sheet-position' as const, sheetId: 'a', position: { x: 3, y: 4 } }, affectedSheetIds: ['a'] },
      { intent: { kind: 'update-sheet-frame-layout' as const, sheetId: 'a', position: { x: 3, y: 4 }, size: { width: 300, height: 200 } }, affectedSheetIds: ['a'] },
      { intent: { kind: 'update-sheet-visual-scale' as const, sheetId: 'a', visualScale: 0.75 }, affectedSheetIds: ['a'] },
    ];
    for (const entry of entries) await transport.execute(entry);
    expect(api.writeAxisSizes).toHaveBeenCalledWith('a', [{ axis: 'row', axisId: 'r', size: 30 }], { revision: 1 });
    expect(api.deleteSheet).toHaveBeenCalledWith('a', { revision: 2 });
    expect(api.renameSheet).toHaveBeenCalledWith('a', 'renamed', { revision: 2 });
    expect(api.updateSheetPosition).toHaveBeenCalledWith('a', { x: 3, y: 4 }, { revision: 3 });
    expect(api.updateSheetFrameLayout).toHaveBeenCalledWith('a', { x: 3, y: 4 }, { width: 300, height: 200 }, { revision: 4 });
    expect(api.updateSheetVisualScale).toHaveBeenCalledWith('a', 0.75, { revision: 5 });
  });

  it('blocks cell and z-order writes until every expected revision is known', async () => {
    const transport = new WorkbookPersistenceTransport({ writeCells: vi.fn(), updateSheetZOrder: vi.fn() } as Partial<WorkbookApi>);
    await expect(transport.execute({
      intent: { kind: 'write-cells', writes: [{ sheetId: 'a', rowId: 'r', columnId: 'c', beforeRaw: null, afterRaw: 'value' }] },
      affectedSheetIds: ['a'],
    })).resolves.toEqual({ kind: 'blocked', reason: 'Missing revision for a cell patch.' });
    await expect(transport.execute({
      intent: { kind: 'update-sheet-z-order', updates: [{ sheetId: 'a', zIndex: 1 }] },
      affectedSheetIds: ['a'],
    })).resolves.toEqual({ kind: 'blocked', reason: 'Missing revision for a z-order update.' });
  });

  it('short-circuits known missing sheets and preserves surviving z-order work', async () => {
    const coordinator = new (await import('@infrastructure/persistence/workbookPersistenceCoordinator')).WorkbookPersistenceCoordinator();
    coordinator.confirmSheetMissing('missing');
    const updateSheetZOrder = vi.fn().mockResolvedValue({ sheets: [{ sheetId: 'live', revision: 2 }] });
    const transport = new WorkbookPersistenceTransport({ updateSheetZOrder } as Partial<WorkbookApi>, coordinator);
    transport.recordRevision('live', 1);
    await expect(transport.execute({ intent: rename('missing', 'gone'), affectedSheetIds: ['missing'] }))
      .resolves.toEqual({ kind: 'missing-sheet', sheetIds: ['missing'] });
    await expect(transport.execute({
      intent: { kind: 'update-sheet-z-order', updates: [{ sheetId: 'missing', zIndex: 1 }, { sheetId: 'live', zIndex: 2 }] },
      affectedSheetIds: ['missing', 'live'],
    })).resolves.toEqual({ kind: 'saved', revisions: [{ sheetId: 'live', revision: 2 }], missingSheetIds: ['missing'] });
  });

  it('turns a single-request not-found response into a missing-sheet result', async () => {
    const transport = new WorkbookPersistenceTransport({
      renameSheet: vi.fn().mockRejectedValue(new WorkbookApiError('missing', 404, 'sheet-not-found')),
    } as Partial<WorkbookApi>);
    await expect(transport.execute({ intent: rename('gone', 'unused'), affectedSheetIds: ['gone'] }))
      .resolves.toEqual({ kind: 'missing-sheet', sheetIds: ['gone'] });
  });

  it('reports conflict reload misses without replaying an unsafe ordinary mutation', async () => {
    const renameSheet = vi.fn().mockRejectedValue(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict'));
    const loadSheet = vi.fn().mockRejectedValue(new WorkbookApiError('missing', 404, 'sheet-not-found'));
    const transport = new WorkbookPersistenceTransport({ renameSheet, loadSheet } as Partial<WorkbookApi>);
    transport.recordRevision('gone', 1);
    await expect(transport.execute({ intent: rename('gone', 'unused'), affectedSheetIds: ['gone'] }))
      .resolves.toEqual({ kind: 'missing-sheet', sheetIds: ['gone'] });
    expect(renameSheet).toHaveBeenCalledTimes(1);
  });

  it('does not issue a z-order request when every affected sheet is already missing', async () => {
    const coordinator = new (await import('@infrastructure/persistence/workbookPersistenceCoordinator')).WorkbookPersistenceCoordinator();
    coordinator.confirmSheetMissing('a'); coordinator.confirmSheetMissing('b');
    const updateSheetZOrder = vi.fn();
    const transport = new WorkbookPersistenceTransport({ updateSheetZOrder } as Partial<WorkbookApi>, coordinator);
    await expect(transport.execute({
      intent: { kind: 'update-sheet-z-order', updates: [{ sheetId: 'a', zIndex: 1 }, { sheetId: 'b', zIndex: 2 }] },
      affectedSheetIds: ['a', 'b'],
    })).resolves.toEqual({ kind: 'missing-sheet', sheetIds: ['a', 'b'] });
    expect(updateSheetZOrder).not.toHaveBeenCalled();
  });

  it('propagates an ordinary API failure without attempting conflict recovery', async () => {
    const failure = new WorkbookApiError('server error', 500, 'server-error');
    const loadSheet = vi.fn();
    const transport = new WorkbookPersistenceTransport({
      writeCells: vi.fn().mockRejectedValue(failure),
      loadSheet,
    } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);

    await expect(transport.execute({
      intent: { kind: 'write-cells', writes: [
        { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
      ] },
      affectedSheetIds: ['a'],
    })).rejects.toBe(failure);
    expect(loadSheet).not.toHaveBeenCalled();
  });

  it('recovers an untracked ambiguous cell response from its complete remote after-state', async () => {
    const saved = sheetDocument({ id: 'a', name: 'A', revision: 2, cells: { A1: 'local' } });
    const transport = new WorkbookPersistenceTransport({
      writeCells: vi.fn().mockRejectedValue(new TypeError('response lost')),
      loadSheet: vi.fn().mockResolvedValue(saved),
    } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);

    await expect(transport.execute({
      intent: { kind: 'write-cells', writes: [
        { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
      ] },
      affectedSheetIds: ['a'],
    })).resolves.toEqual({ kind: 'saved', revisions: [{ sheetId: 'a', revision: 2 }] });
  });

  it('reports a missing sheet while recovering a failed cell response', async () => {
    const transport = new WorkbookPersistenceTransport({
      writeCells: vi.fn().mockRejectedValue(new TypeError('response lost')),
      loadSheet: vi.fn().mockRejectedValue(new WorkbookApiError('missing', 404, 'sheet-not-found')),
    } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);

    await expect(transport.execute({
      intent: { kind: 'write-cells', writes: [
        { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
      ] },
      affectedSheetIds: ['a'],
    })).resolves.toEqual({ kind: 'missing-sheet', sheetIds: ['a'] });
  });

  it('revalidates a guarded before-state before a successful manual retry', async () => {
    const before = sheetDocument({ id: 'a', name: 'A', revision: 2 });
    const writeCells = vi.fn()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce({ sheets: [{ sheetId: 'a', revision: 3 }] });
    const transport = new WorkbookPersistenceTransport({
      writeCells,
      loadSheet: vi.fn().mockResolvedValue(before),
    } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('cell', { kind: 'write-cells', writes: [
      { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
    ] });

    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    outbox.retry('cell');
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(writeCells).toHaveBeenCalledTimes(2);
  });

  it('accepts a guarded operation when manual retry finds its complete after-state', async () => {
    const after = sheetDocument({ id: 'a', name: 'A', revision: 2, cells: { A1: 'local' } });
    const writeCells = vi.fn().mockRejectedValue(new TypeError('response lost'));
    const loadSheet = vi.fn()
      .mockResolvedValueOnce(sheetDocument({ id: 'a', name: 'A', revision: 1, cells: { A1: 'remote' } }))
      .mockResolvedValueOnce(after);
    const transport = new WorkbookPersistenceTransport({ writeCells, loadSheet } as Partial<WorkbookApi>);
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('cell', { kind: 'write-cells', writes: [
      { sheetId: 'a', rowId: 'a:row:1', columnId: 'a:column:1', beforeRaw: null, afterRaw: 'local' },
    ] });

    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    outbox.retry('cell');
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(writeCells).toHaveBeenCalledTimes(1);
  });

  it('preserves blocked and newly missing outcomes while filtering a known-missing z-order target', async () => {
    const { WorkbookPersistenceCoordinator } = await import('@infrastructure/persistence/workbookPersistenceCoordinator');
    const blockedCoordinator = new WorkbookPersistenceCoordinator();
    blockedCoordinator.confirmSheetMissing('known-missing');
    const blocked = new WorkbookPersistenceTransport({ updateSheetZOrder: vi.fn() } as Partial<WorkbookApi>, blockedCoordinator);
    const intent = {
      kind: 'update-sheet-z-order' as const,
      updates: [{ sheetId: 'known-missing', zIndex: 1 }, { sheetId: 'live', zIndex: 2 }],
    };

    await expect(blocked.execute({ intent, affectedSheetIds: ['known-missing', 'live'] }))
      .resolves.toEqual({ kind: 'blocked', reason: 'Missing revision for a z-order update.' });

    const missingCoordinator = new WorkbookPersistenceCoordinator();
    missingCoordinator.confirmSheetMissing('known-missing');
    const missing = new WorkbookPersistenceTransport({
      updateSheetZOrder: vi.fn().mockRejectedValue(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict')),
      loadSheet: vi.fn().mockRejectedValue(new WorkbookApiError('missing', 404, 'sheet-not-found')),
    } as Partial<WorkbookApi>, missingCoordinator);
    missing.recordRevision('live', 1);

    await expect(missing.execute({ intent, affectedSheetIds: ['known-missing', 'live'] }))
      .resolves.toEqual({ kind: 'missing-sheet', sheetIds: ['known-missing', 'live'] });
  });
});
