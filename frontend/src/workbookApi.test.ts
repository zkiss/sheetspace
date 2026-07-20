import { afterEach, describe, expect, it, vi } from 'vitest';
import { workbookApi, WorkbookApiError } from './workbookApi';
import type { Workbook } from './workbook';

const workbook: Workbook = {
  version: 1,
  sheets: [
    {
      id: 'sheet-1',
      name: 'Inputs',
      revision: 0,
      position: { x: 12, y: 24 },
      frameSize: { width: 240, height: 160 },
      zIndex: 1,
      columnCount: 10,
      rowCount: 20,
      cells: {
        A1: '42',
      },
    },
  ],
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function mockFetch(body: unknown, init?: ResponseInit) {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(body, init)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workbookApi', () => {
  it('loads the current workbook', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ version: 1, sheetIds: ['sheet-1'] }))
      .mockResolvedValueOnce(jsonResponse(workbook.sheets[0]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(workbookApi.loadWorkbook()).resolves.toEqual(workbook);

    expect(fetchMock).toHaveBeenCalledWith('/api/workbook', { headers: {} });
    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/sheet-1', { headers: {} });
  });

  it('loads one sheet by id', async () => {
    const fetchMock = mockFetch(workbook.sheets[0]);

    await expect(workbookApi.loadSheet('sheet 1')).resolves.toEqual(workbook.sheets[0]);

    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/sheet%201', { headers: {} });
  });

  it('creates sheets through the backend mutation endpoint', async () => {
    const fetchMock = mockFetch(workbook.sheets[0]);

    await expect(
      workbookApi.createSheet({ name: 'Inputs', position: { x: 12, y: 24 } }),
    ).resolves.toEqual(workbook.sheets[0]);

    expect(fetchMock).toHaveBeenCalledWith('/api/sheets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Inputs', position: { x: 12, y: 24 } }),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('keeps local-only sheet fields out of the sheet creation request body', async () => {
    const fetchMock = mockFetch(workbook.sheets[0]);

    await workbookApi.createSheet({
      id: 'pending:local-only-id',
      name: workbook.sheets[0].name,
      position: workbook.sheets[0].position,
      frameSize: workbook.sheets[0].frameSize,
      zIndex: workbook.sheets[0].zIndex,
    } as Parameters<typeof workbookApi.createSheet>[0]);

    expect(fetchMock).toHaveBeenCalledWith('/api/sheets', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Inputs',
        position: { x: 12, y: 24 },
        frameSize: { width: 240, height: 160 },
        zIndex: 1,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('exposes sheet rename position frame size and z-order update calls', async () => {
    const fetchMock = mockFetch({ sheetId: 'sheet-1', revision: 1 });

    await workbookApi.renameSheet('sheet-1', 'Renamed');
    await workbookApi.updateSheetPosition('sheet-1', { x: 48, y: 96 });
    await workbookApi.updateSheetFrameSize('sheet-1', { width: 320, height: 220 });
    await workbookApi.updateSheetZIndex('sheet-1', 3);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sheets/sheet-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/sheets/sheet-1', {
      method: 'PATCH',
      body: JSON.stringify({ position: { x: 48, y: 96 } }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/sheets/sheet-1', {
      method: 'PATCH',
      body: JSON.stringify({ frameSize: { width: 320, height: 220 } }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/sheets/sheet-1', {
      method: 'PATCH',
      body: JSON.stringify({ zIndex: 3 }),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('deletes sheets through the backend mutation endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await workbookApi.deleteSheet('sheet 1', { revision: 3 });

    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/sheet%201', {
      method: 'DELETE',
      headers: { 'If-Match': '3' },
    });
  });

  it('exposes cell content, row append, and column append update calls', async () => {
    const fetchMock = mockFetch({ sheetId: 'sheet 1', revision: 1, rowCount: 21, columnCount: 11 });

    await workbookApi.updateCellContent('sheet 1', 'A1', '=SUM(B1:B2)');
    await workbookApi.appendRow('sheet 1');
    await workbookApi.appendColumn('sheet 1');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sheets/sheet%201/cells/A1', {
      method: 'PUT',
      body: JSON.stringify('=SUM(B1:B2)'),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/sheets/sheet%201/rows', {
      method: 'POST',
      headers: {},
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/sheets/sheet%201/columns', {
      method: 'POST',
      headers: {},
    });
  });

  it('sends sheet revisions as optimistic lock tokens for revisioned mutations', async () => {
    const fetchMock = mockFetch({ sheetId: 'sheet-1', revision: 1, rowCount: 21 });

    await workbookApi.updateCellContent('sheet-1', 'A1', 'Value', { revision: 7 });
    await workbookApi.appendRow('sheet-1', { revision: 8 });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sheets/sheet-1/cells/A1', {
      method: 'PUT',
      body: JSON.stringify('Value'),
      headers: { 'Content-Type': 'application/json', 'If-Match': '7' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/sheets/sheet-1/rows', {
      method: 'POST',
      headers: { 'If-Match': '8' },
    });
  });

  it('sends canonical formula strings without reference metadata', async () => {
    const fetchMock = mockFetch({ sheetId: 'sheet-2', revision: 1 });

    await workbookApi.updateCellContent('sheet-2', 'A1', '=SUM(sheet-1!A1)', { revision: 7 });

    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/sheet-2/cells/A1', {
      method: 'PUT',
      body: JSON.stringify('=SUM(sheet-1!A1)'),
      headers: { 'Content-Type': 'application/json', 'If-Match': '7' },
    });
  });

  it('throws testable API errors for failed backend responses', async () => {
    mockFetch({ ok: false, error: 'sheet-not-found' }, { status: 404 });

    await expect(workbookApi.appendRow('missing')).rejects.toMatchObject({
      name: 'WorkbookApiError',
      message: 'sheet-not-found',
      status: 404,
      code: 'sheet-not-found',
    } satisfies Partial<WorkbookApiError>);
  });
});
