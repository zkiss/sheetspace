import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@test/apiClients';
import { WorkbookApiError, type WorkbookApi } from '@infrastructure/persistence/workbookApi';
import { WorkbookOutbox } from '@infrastructure/persistence/workbookOutbox';
import { WorkbookPersistenceTransport } from '@infrastructure/persistence/workbookPersistenceTransport';

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
  it('does not route a multi-write intent to the single-cell API', async () => {
    const updateCellContent = vi.fn(); const transport = new WorkbookPersistenceTransport({ updateCellContent } as Partial<WorkbookApi>);
    const result = await transport.execute({ intent: { kind: 'write-cells', sheetId: 'a', writes: [{ cell: { rowId: 'r', columnId: 'c' }, raw: '1' }, { cell: { rowId: 'r', columnId: 'd' }, raw: '2' }] }, affectedSheetIds: ['a'] });
    expect(result.kind).toBe('blocked'); expect(updateCellContent).not.toHaveBeenCalled();
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
});
