import { afterEach, describe, expect, it, vi } from 'vitest';
import { workbookApi, WorkbookApiError } from './workbookApi';
import { WorkbookOutbox } from './workbookOutbox';
import { WorkbookPersistenceTransport } from './workbookPersistenceTransport';
import { sheetDocument } from '@test-support/workbookFactories';

const before = ['r1', 'r2', 'r3'];
const after = ['r2', 'r1', 'r3'];
const intent = { kind: 'write-axis-order', sheetId: 'a', axis: 'row', before, after } as const;
const sheet = (order: readonly string[], revision: number) => {
  const document = sheetDocument({ id: 'a', name: 'A', revision });
  return { ...document, content: { ...document.content, rows: [...order] } };
};
const conflict = () => new WorkbookApiError('conflict', 409, 'sheet-revision-conflict');
const setup = (writeAxisOrder: ReturnType<typeof vi.fn>, loadSheet = vi.fn().mockResolvedValue(sheet(before, 1))) => {
  const transport = new WorkbookPersistenceTransport({ writeAxisOrder, loadSheet });
  transport.recordRevision('a', 1);
  const outbox = new WorkbookOutbox();
  outbox.enqueue('move', intent);
  return { transport, outbox };
};
afterEach(() => vi.unstubAllGlobals());

describe('axis order persistence', () => {
  it('sends the revisioned API request and decodes its sheet', async () => {
    const response = { id: 'a', name: 'A', revision: 2, frame: { position: { x: 0, y: 0 }, visualScale: 1, zIndex: 0 }, presentation: { rowHeights: {}, columnWidths: {} }, content: { kind: 'tabular', rows: ['r2', 'r1'], columns: ['c'], cells: [] } };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const result = await workbookApi.writeAxisOrder('a/b', 'row', ['r2', 'r1'], 4);
    expect(result.content.rows).toEqual(response.content.rows);
    expect(fetch).toHaveBeenCalledWith('/api/sheets/a%2Fb/axis-order', expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '4' }, body: JSON.stringify({ axis: 'row', order: ['r2', 'r1'] }) }));
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bound-sheet-structure' }), { status: 400 }));
    await expect(workbookApi.writeAxisOrder('a', 'column', [], 1)).rejects.toMatchObject({ status: 400, code: 'bound-sheet-structure' });
  });
  it('clones order arrays and keeps dependent moves behind failures', async () => {
    const old = [...before]; const next = [...after];
    const outbox = new WorkbookOutbox();
    outbox.enqueue('one', { ...intent, before: old, after: next });
    outbox.enqueue('two', { ...intent, before: next, after: old });
    old.reverse(); next.reverse();
    expect(outbox.inspect('one')?.intent).toEqual(intent);
    expect(outbox.snapshot().map((entry) => entry.policy)).toEqual(['append', 'append']);
    await outbox.executeNext({ execute: async () => { throw Error('offline'); } });
    expect(await outbox.executeNext({ execute: vi.fn() })).toBeUndefined();
  });
  it('acknowledges a committed move with a lost response', async () => {
    const write = vi.fn().mockRejectedValue(new TypeError('offline'));
    const { outbox, transport } = setup(write, vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValue(sheet(after, 2)));
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(transport.revision('a')).toBe(2);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('retries a conflict only after proving the original order', async () => {
    const write = vi.fn().mockRejectedValueOnce(conflict()).mockResolvedValueOnce(sheet(after, 4));
    const { outbox, transport } = setup(write, vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValue(sheet(before, 3)));
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(write).toHaveBeenLastCalledWith('a', 'row', after, 3);
    expect(transport.revision('a')).toBe(4);
  });
  it.each([
    new TypeError('offline'),
    new WorkbookApiError('invalid response', undefined, 'invalid-workbook-read-contract'),
    new WorkbookApiError('server error', 500),
  ])('recovers a lost conflict-retry response and releases the inverse move: %s', async (failure) => {
    const write = vi.fn().mockRejectedValueOnce(conflict()).mockRejectedValueOnce(failure).mockResolvedValueOnce(sheet(before, 5));
    const load = vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValueOnce(sheet(before, 3))
      .mockResolvedValueOnce(sheet(after, 4)).mockResolvedValueOnce(sheet(after, 4));
    const { outbox, transport } = setup(write, load);
    outbox.enqueue('undo', { ...intent, before: after, after: before });
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(transport.revision('a')).toBe(4);
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(write).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenNthCalledWith(2, 'a', 'row', after, 3);
    expect(write).toHaveBeenNthCalledWith(3, 'a', 'row', before, 4);
    expect(transport.revision('a')).toBe(5);
  });
  it.each([
    ['after', after, 'succeeded'],
    ['before', before, 'failed'],
    ['divergent', ['r3', 'r2', 'r1'], 'failed'],
  ])('recovers a second conflict with %s order without a third write', async (_name, order, status) => {
    const write = vi.fn().mockRejectedValue(conflict());
    const load = vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValueOnce(sheet(before, 2)).mockResolvedValueOnce(sheet(order, 3));
    const { outbox, transport } = setup(write, load);
    outbox.enqueue('undo', { ...intent, before: after, after: before });
    expect((await outbox.executeNext(transport))?.status).toBe(status);
    expect(write).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(3);
    if (status === 'failed') expect(await outbox.executeNext(transport)).toBeUndefined();
  });
  it('does not automatically replay an ambiguous retry with proven prior order', async () => {
    const write = vi.fn().mockRejectedValueOnce(conflict()).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(sheet(after, 5));
    const load = vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValueOnce(sheet(before, 2))
      .mockResolvedValueOnce(sheet(before, 3)).mockResolvedValueOnce(sheet(before, 4));
    const { outbox, transport } = setup(write, load);
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    expect(write).toHaveBeenCalledTimes(2);
    outbox.retry('move');
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(write).toHaveBeenLastCalledWith('a', 'row', after, 4);
  });
  it('re-proves a committed retry after its recovery load fails', async () => {
    const write = vi.fn().mockRejectedValueOnce(conflict()).mockRejectedValueOnce(new TypeError('offline'));
    const load = vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValueOnce(sheet(before, 2))
      .mockRejectedValueOnce(new Error('load failed')).mockResolvedValueOnce(sheet(after, 3));
    const { outbox, transport } = setup(write, load);
    outbox.enqueue('undo', { ...intent, before: after, after: before });
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    expect(await outbox.executeNext(transport)).toBeUndefined();
    transport.recordRevision('a', 10);
    outbox.retry('move');
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(load).toHaveBeenCalledTimes(4);
    expect(write).toHaveBeenCalledTimes(2);
  });
  it('never overwrites a divergent order, including after manual retry', async () => {
    const write = vi.fn().mockRejectedValue(conflict());
    const load = vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValue(sheet(['r3', 'r2', 'r1'], 3));
    const { outbox, transport } = setup(write, load);
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    outbox.retry('move');
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('re-proves order after a failed recovery and manually retries a pre-commit failure', async () => {
    const write = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(sheet(after, 3));
    const load = vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockRejectedValueOnce(new Error('load failed')).mockResolvedValueOnce(sheet(before, 2));
    const { outbox, transport } = setup(write, load);
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    outbox.retry('move');
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(write).toHaveBeenLastCalledWith('a', 'row', after, 2);
  });
  it('serializes forward and inverse with successive revisions', async () => {
    const write = vi.fn().mockResolvedValueOnce(sheet(after, 2)).mockResolvedValueOnce(sheet(before, 3));
    const { outbox, transport } = setup(write, vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValueOnce(sheet(after, 2)));
    outbox.enqueue('undo', { ...intent, before: after, after: before });
    await outbox.executeNext(transport); await outbox.executeNext(transport);
    expect(write).toHaveBeenNthCalledWith(2, 'a', 'row', before, 2);
    expect(transport.revision('a')).toBe(3);
  });
  it('blocks missing revision and reports a missing sheet', async () => {
    const write = vi.fn().mockRejectedValue(new WorkbookApiError('missing', 404, 'sheet-not-found'));
    const transport = new WorkbookPersistenceTransport({ writeAxisOrder: write, loadSheet: vi.fn().mockResolvedValue(sheet(before, 1)) });
    const entry = { operationId: 'move', intent, affectedSheetIds: ['a'] };
    expect((await transport.execute(entry)).kind).toBe('blocked');
    transport.recordRevision('a', 1);
    expect(await transport.execute(entry)).toEqual({ kind: 'missing-sheet', sheetIds: ['a'] });
  });
  it('recovers malformed successful responses and server errors as ambiguous', async () => {
    for (const failure of [new WorkbookApiError('invalid response', undefined, 'invalid-workbook-read-contract'), new WorkbookApiError('server error', 500)]) {
      const write = vi.fn().mockRejectedValue(failure);
      const { outbox, transport } = setup(write, vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValue(sheet(after, 2)));
      expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
      expect(write).toHaveBeenCalledOnce();
    }
  });
  it('reports missing sheets during recovery and does not retry rejected model columns', async () => {
    const missing = new WorkbookApiError('missing', 404, 'sheet-not-found');
    const first = setup(vi.fn().mockRejectedValue(conflict()), vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockRejectedValue(missing));
    expect(await first.transport.execute({ operationId: 'move', intent, affectedSheetIds: ['a'] })).toEqual({ kind: 'missing-sheet', sheetIds: ['a'] });
    const guard = new WorkbookApiError('bound', 400, 'bound-sheet-structure');
    const load = vi.fn().mockResolvedValue(sheet(before, 1));
    const second = setup(vi.fn().mockRejectedValue(guard), load);
    expect((await second.outbox.executeNext(second.transport))?.status).toBe('failed');
    expect(load).toHaveBeenCalledOnce();
  });
  it('blocks a reorder when a preceding position conflict refreshed an external order', async () => {
    const external = ['r3', 'r2', 'r1'];
    const loadSheet = vi.fn().mockResolvedValue(sheet(external, 2));
    const updateSheetPosition = vi.fn().mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ sheetId: 'a', revision: 3 });
    const writeAxisOrder = vi.fn();
    const transport = new WorkbookPersistenceTransport({ loadSheet, updateSheetPosition, writeAxisOrder });
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('position', { kind: 'update-sheet-position', sheetId: 'a', position: { x: 5, y: 6 } });
    outbox.enqueue('move', intent);
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    expect(writeAxisOrder).not.toHaveBeenCalled();
  });
  it('uses the revision of the proven order even if the coordinator knows a newer revision', async () => {
    const write = vi.fn().mockResolvedValue(sheet(after, 3));
    const { outbox, transport } = setup(write, vi.fn().mockResolvedValue(sheet(before, 2)));
    transport.recordRevision('a', 5);
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(write).toHaveBeenCalledWith('a', 'row', after, 2);
  });
  it('does not send when the initial order proof is unavailable', async () => {
    const write = vi.fn();
    const { outbox, transport } = setup(write, vi.fn().mockRejectedValue(new Error('offline')));
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    expect(write).not.toHaveBeenCalled();
  });
});
