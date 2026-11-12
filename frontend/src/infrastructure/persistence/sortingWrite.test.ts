import { afterEach, describe, expect, it, vi } from 'vitest';
import { sheetDocument } from '@test-support/workbookFactories';
import { workbookApi, WorkbookApiError } from './workbookApi';
import { WorkbookOutbox } from './workbookOutbox';
import { WorkbookPersistenceTransport } from './workbookPersistenceTransport';

const before = { sorting: [], rows: ['r1', 'r2'] };
const after = { sorting: [{ columnId: 'c', direction: 'ascending' as const }], rows: ['r2', 'r1'] };
const intent = { kind: 'write-sorting' as const, sheetId: 'a', before, after };
const sheet = (state: typeof before | typeof after, revision: number) => {
  const base = sheetDocument({ id: 'a', name: 'A', revision });
  return { ...base, sorting: state.sorting, content: { ...base.content, rows: state.rows } };
};

describe('sorting persistence', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends criteria and order in one revisioned request', async () => {
    const response = { id: 'a', name: 'A', revision: 2, sorting: after.sorting, frame: { position: { x: 0, y: 0 }, visualScale: 1, zIndex: 1 }, presentation: { rowHeights: {}, columnWidths: {} }, content: { kind: 'tabular', rows: after.rows, columns: ['c'], cells: [] } };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect((await workbookApi.writeSorting('a/b', after.sorting, after.rows, 1)).sorting).toEqual(after.sorting);
    expect(fetch).toHaveBeenCalledWith('/api/sheets/a%2Fb/sorting', expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '1' }, body: JSON.stringify({ sorting: after.sorting, order: after.rows }) }));
  });
  it('copies the outbox payload and retries a conflict only after proving both prior fields', async () => {
    const loadSheet = vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValueOnce(sheet(before, 3));
    const writeSorting = vi.fn().mockRejectedValueOnce(new WorkbookApiError('conflict', 409, 'sheet-revision-conflict')).mockResolvedValueOnce(sheet(after, 4));
    const transport = new WorkbookPersistenceTransport({ loadSheet, writeSorting });
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('sort', intent);
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(writeSorting).toHaveBeenLastCalledWith('a', after.sorting, after.rows, 3);
    expect(transport.revision('a')).toBe(4);
  });

  it('refuses to overwrite a concurrent change to either sorting or order', async () => {
    const writeSorting = vi.fn();
    const transport = new WorkbookPersistenceTransport({ loadSheet: vi.fn().mockResolvedValue(sheet({ ...before, rows: after.rows }, 2)), writeSorting });
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('sort', intent);
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    expect(writeSorting).not.toHaveBeenCalled();
  });

  it('recognizes a committed write after an ambiguous response', async () => {
    const loadSheet = vi.fn().mockResolvedValueOnce(sheet(before, 1)).mockResolvedValueOnce(sheet(after, 2));
    const writeSorting = vi.fn().mockRejectedValue(new TypeError('offline'));
    const transport = new WorkbookPersistenceTransport({ loadSheet, writeSorting });
    transport.recordRevision('a', 1);
    const outbox = new WorkbookOutbox();
    outbox.enqueue('sort', intent);
    expect((await outbox.executeNext(transport))?.status).toBe('succeeded');
    expect(transport.revision('a')).toBe(2);
  });
});
