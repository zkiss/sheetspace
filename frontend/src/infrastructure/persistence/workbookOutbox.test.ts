import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@test-support/apiClients';
import { WorkbookOutbox } from '@infrastructure/persistence/workbookOutbox';
import type { Workbook } from '@workbook/core/model';

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
    if (inspected.intent.kind === 'update-sheet-position') inspected.intent.position.y = 88;
    if (snapshotted.intent.kind === 'update-sheet-position') snapshotted.intent.position.x = 77;

    outbox.retry('move');
    expect(outbox.inspect('move')).toMatchObject({ status: 'queued', failure });
    const execute = vi.fn(async () => ({ kind: 'saved', revisions: [] } as const));
    await outbox.executeNext({ execute });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ intent: { kind: 'update-sheet-position', sheetId: 'a', position: { x: 1, y: 2 } } }));
    expect(outbox.inspect('move')).toMatchObject({ status: 'succeeded', failure: undefined });
  });
  it('clones every cell transition at enqueue, snapshot, and transport boundaries', async () => {
    const outbox = new WorkbookOutbox();
    const intent = { kind: 'write-cells' as const, writes: [{ sheetId: 'a', rowId: 'r', columnId: 'c', beforeRaw: ' before ', afterRaw: '=@a[1]' }] };
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
      kind: 'write-cells', writes: [{ sheetId: 'a', rowId: 'r', columnId: 'c', beforeRaw: ' before ', afterRaw: '=@a[1]' }],
    });
    expect(outbox.inspect('cell')?.intent).toEqual({
      kind: 'write-cells', writes: [{ sheetId: 'a', rowId: 'r', columnId: 'c', beforeRaw: ' before ', afterRaw: '=@a[1]' }],
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
  it('blocks a queued model transition when an earlier ordinary save fails', async () => {
    const outbox = new WorkbookOutbox();
    const workbook = { manifest: { version: 1, revision: 0, sheetIds: [] }, documents: {} } as Workbook;
    outbox.enqueue('ordinary', rename('a', 'Unsaved'));
    outbox.enqueue('model', { kind: 'model-lifecycle', before: workbook, after: workbook });
    const completion = outbox.waitFor('model');

    await outbox.executeNext({ execute: async () => { throw new Error('offline'); } });

    await expect(completion).resolves.toMatchObject({ operationId: 'model', status: 'blocked' });
    expect(outbox.hasFailedPrerequisiteForModelTransition()).toBe(true);
    expect(outbox.inspect('model')?.failure).toBeInstanceOf(Error);
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
