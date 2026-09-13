import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeSheetDocument, workbookApi, WorkbookApiError, type SheetDocumentResponse } from './workbookApi';
import { WorkbookOutbox } from './workbookOutbox';
import { WorkbookPersistenceTransport } from './workbookPersistenceTransport';
import { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';
import { deferred } from '@test-support/apiClients';
import { sheetDocument } from '@test-support/workbookFactories';

const source = sheetDocument({ id: 'sheet-sizes', name: 'Sizes' });
const document: SheetDocumentResponse = { ...source, content: { ...source.content, cells: [] } };
const row = document.content.rows[0], column = document.content.columns[0];
const writes = [{ axis: 'row' as const, axisId: row, size: 44 }];
const intent = { kind: 'write-axis-sizes' as const, sheetId: document.id, writes };
afterEach(() => vi.unstubAllGlobals());

describe('presentation API contract', () => {
  it('sends stable targets, explicit removal and the expected revision', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sheetId: document.id, revision: 8 })));
    vi.stubGlobal('fetch', fetchMock);
    await workbookApi.writeAxisSizes('sheet /1', [...writes, { axis: 'column', axisId: column, size: null }], { revision: 7 });
    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/sheet%20%2F1/presentation', {
      method: 'PATCH', body: JSON.stringify({ writes: [...writes, { axis: 'column', axisId: column, size: null }] }),
      headers: { 'Content-Type': 'application/json', 'If-Match': '7' },
    });
  });

  it('decodes custom dimensions without changing raw cells and copies maps', () => {
    const response = { ...document, presentation: { rowHeights: { [row]: 32 }, columnWidths: { [column]: 100 } } };
    const decoded = decodeSheetDocument(response);
    expect(decoded.presentation).toEqual(response.presentation);
    expect(decoded.presentation.rowHeights).not.toBe(response.presentation.rowHeights);
    expect(decoded.content).toEqual(decodeSheetDocument(document).content);
  });

  it.each([
    undefined, {}, { rowHeights: [], columnWidths: {} }, { rowHeights: {}, columnWidths: 'wrong' },
    { rowHeights: { [column]: 40 }, columnWidths: {} },
    { rowHeights: { [row]: null }, columnWidths: {} },
    { rowHeights: { [row]: Infinity }, columnWidths: {} },
    { rowHeights: {}, columnWidths: { [column]: 23 } },
  ])('rejects invalid current presentation contracts %j', (presentation) => {
    expect(() => decodeSheetDocument({ ...document, presentation } as SheetDocumentResponse)).toThrowError(expect.objectContaining({ code: 'invalid-workbook-read-contract' }));
  });
});

describe('presentation persistence', () => {
  it('appends complete incremental intent, clones payloads and uses current revisions across mixed writes', async () => {
    const outbox = new WorkbookOutbox();
    outbox.enqueue('size-1', intent);
    const secondWrites = [{ axis: 'column' as const, axisId: column, size: 140 }];
    outbox.enqueue('size-2', { ...intent, writes: secondWrites });
    secondWrites[0].size = 900;
    outbox.enqueue('reset', { ...intent, writes: [{ ...writes[0], size: null }] });
    outbox.enqueue('cell', { kind: 'write-cells', writes: [{ sheetId: document.id, rowId: row, columnId: column, beforeRaw: null, afterRaw: '5' }] });
    outbox.enqueue('frame', { kind: 'update-sheet-position', sheetId: document.id, position: { x: 10, y: 20 } });
    outbox.enqueue('rename', { kind: 'rename-sheet', sheetId: document.id, name: 'Renamed' });
    outbox.enqueue('z', { kind: 'update-sheet-z-order', updates: [{ sheetId: document.id, zIndex: 2 }] });
    let revision = 3;
    const received: unknown[] = [];
    const save = async (...args: unknown[]) => {
      received.push(args);
      expect(args[args.length - 1]).toEqual({ revision });
      return { sheetId: document.id, revision: ++revision };
    };
    const transport = new WorkbookPersistenceTransport({ writeAxisSizes: vi.fn(save), updateCellContent: vi.fn(save), updateSheetPosition: vi.fn(save), renameSheet: vi.fn(save),
      updateSheetZOrder: vi.fn(async (updates) => {
        expect(updates).toEqual([{ sheetId: document.id, zIndex: 2, expectedRevision: revision }]);
        return { sheets: [{ sheetId: document.id, revision: ++revision }] };
      }),
    }, () => 'A1');
    transport.recordRevision(document.id, revision);
    while (await outbox.executeNext(transport)) { /* drain in order */ }
    expect(received.slice(0, 3).map((args) => (args as unknown[])[1])).toEqual([writes, [{ axis: 'column', axisId: column, size: 140 }], [{ ...writes[0], size: null }]]);
    expect(outbox.snapshot().every((entry) => entry.status === 'succeeded')).toBe(true);
    expect(outbox.snapshot().slice(0, 3).every((entry) => entry.policy === 'append')).toBe(true);
    expect(transport.revision(document.id)).toBe(10);
  });

  it('serializes presentation with structural requests and allows unrelated sheets to proceed', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    coordinator.recordRevision(document.id, 1);
    const pending = deferred<{ sheetId: string; revision: number }>();
    const size = vi.fn().mockReturnValue(pending.promise);
    const transport = new WorkbookPersistenceTransport({ writeAxisSizes: size }, undefined, coordinator);
    const presentation = transport.execute({ intent, affectedSheetIds: [document.id] });
    const append = vi.fn(async () => { expect(coordinator.revision(document.id)).toBe(2); coordinator.recordRevision(document.id, 3); });
    const structure = coordinator.serialize([document.id], append);
    const unrelated = vi.fn(async () => undefined);
    await coordinator.serialize(['other'], unrelated);
    expect(size).toHaveBeenCalledTimes(1);
    expect(append).not.toHaveBeenCalled();
    expect(unrelated).toHaveBeenCalledTimes(1);
    pending.resolve({ sheetId: document.id, revision: 2 });
    await Promise.all([presentation, structure]);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('retries a conflict with a reloaded revision and preserves exact intent', async () => {
    const save = vi.fn().mockRejectedValueOnce(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict')).mockResolvedValue({ sheetId: document.id, revision: 9 });
    const transport = new WorkbookPersistenceTransport({ writeAxisSizes: save, loadSheet: vi.fn().mockResolvedValue(sheetDocument({ id: document.id, name: 'Sizes', revision: 8 })) });
    transport.recordRevision(document.id, 3);
    expect(await transport.execute({ intent, affectedSheetIds: [document.id] })).toEqual({ kind: 'saved', revisions: [{ sheetId: document.id, revision: 9 }] });
    expect(save).toHaveBeenNthCalledWith(1, document.id, writes, { revision: 3 });
    expect(save).toHaveBeenNthCalledWith(2, document.id, writes, { revision: 8 });
  });

  it('retries failures without losing following targets and handles missing sheets', async () => {
    const outbox = new WorkbookOutbox();
    outbox.enqueue('one', intent);
    outbox.enqueue('two', { ...intent, writes: [{ axis: 'column', axisId: column, size: 140 }] });
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ sheetId: document.id, revision: 1 });
    const transport = new WorkbookPersistenceTransport({ writeAxisSizes: save });
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    expect(await outbox.executeNext(transport)).toBeUndefined();
    outbox.retry('one');
    await outbox.executeNext(transport);
    await outbox.executeNext(transport);
    expect(save).toHaveBeenCalledTimes(3);
    const missing = new WorkbookPersistenceTransport({ writeAxisSizes: vi.fn().mockRejectedValue(new WorkbookApiError('missing', 404, 'sheet-not-found')) });
    expect(await missing.execute({ intent, affectedSheetIds: [document.id] })).toEqual({ kind: 'missing-sheet', sheetIds: [document.id] });
  });
});


describe('shared persistence serialization', () => {
  it('reserves intersecting sheet groups together and releases them after failure', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    const first = deferred<void>();
    const calls: string[] = [];
    const failed = coordinator.serialize(['a', 'b', 'a'], async () => { calls.push('first'); await first.promise; throw new Error('offline'); }).catch(() => undefined);
    const second = coordinator.serialize(['b', 'c'], async () => { calls.push('second'); });
    const third = coordinator.serialize(['a', 'c'], async () => { calls.push('third'); });
    expect(calls).toEqual(['first']);
    first.resolve();
    await Promise.all([failed, second, third]);
    expect(calls).toEqual(['first', 'second', 'third']);
    await coordinator.serialize(['a', 'b', 'c'], async () => { calls.push('released'); });
    expect(calls[calls.length - 1]).toBe('released');
  });

  it('skips confirmed missing presentation work while preserving surviving z-order targets', async () => {
    const coordinator = new WorkbookPersistenceCoordinator();
    coordinator.confirmSheetMissing(document.id);
    coordinator.recordRevision('survivor', 3);
    const size = vi.fn();
    const zOrder = vi.fn().mockResolvedValue({ sheets: [{ sheetId: 'survivor', revision: 4 }] });
    const transport = new WorkbookPersistenceTransport({ writeAxisSizes: size, updateSheetZOrder: zOrder }, undefined, coordinator);
    expect(await transport.execute({ intent, affectedSheetIds: [document.id] })).toEqual({ kind: 'missing-sheet', sheetIds: [document.id] });
    expect(size).not.toHaveBeenCalled();
    expect(await transport.execute({ intent: { kind: 'update-sheet-z-order', updates: [{ sheetId: document.id, zIndex: 1 }, { sheetId: 'survivor', zIndex: 2 }] }, affectedSheetIds: [document.id, 'survivor'] })).toEqual({ kind: 'saved', revisions: [{ sheetId: 'survivor', revision: 4 }], missingSheetIds: [document.id] });
    expect(zOrder).toHaveBeenCalledWith([{ sheetId: 'survivor', zIndex: 2, expectedRevision: 3 }]);
    expect(await transport.execute({ intent: { kind: 'update-sheet-z-order', updates: [{ sheetId: document.id, zIndex: 1 }] }, affectedSheetIds: [document.id] })).toEqual({ kind: 'missing-sheet', sheetIds: [document.id] });
  });
});
