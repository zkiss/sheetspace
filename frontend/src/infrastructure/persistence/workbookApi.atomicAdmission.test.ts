import { afterEach, describe, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { encodeWorkbookBundle, workbookApi } from './workbookApi';

afterEach(() => vi.unstubAllGlobals());

describe('atomic record admission transport', () => {
  it('sends complete guards and row orders and decodes the current workbook on receipt retry', async () => {
    const first = sheetDocument({ id: 'first', name: 'First', rowCount: 1, columnCount: 1 });
    const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 2, columnCount: 1 });
    const before = workbookWithSheets([first, second]);
    const request = { rowId: 'new', values: { input: '12' }, revision: 3, before, rowOrders: [
      { sheetId: 'first', order: ['new', ...first.content.rows] },
      { sheetId: 'second', order: [...second.content.rows].reverse() },
    ] };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rowId: 'new', alreadyCommitted: true, workbook: encodeWorkbookBundle(before) }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const result = await workbookApi.admitRecordAtomic('first', request);

    expect(result).toEqual({ rowId: 'new', alreadyCommitted: true, workbook: { ...before, dataModels: {} } });
    expect(fetch).toHaveBeenCalledWith('/api/sheets/first/records', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': '3' },
      body: JSON.stringify({ rowId: 'new', values: request.values, before: encodeWorkbookBundle(before), rowOrders: request.rowOrders }),
    });
  });

  it('exposes the identity and revisions of a conflicting dependency', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'sheet-revision-conflict', sheetId: 'other', expectedRevision: 2, actualRevision: 3 }), { status: 409 })));
    const before = workbookWithSheets([]);

    await expect(workbookApi.admitRecordAtomic('first', { rowId: 'new', values: {}, revision: 0, before, rowOrders: [] }))
      .rejects.toMatchObject({ status: 409, code: 'sheet-revision-conflict', context: { sheetId: 'other', expectedRevision: 2, actualRevision: 3 } });
  });
});
