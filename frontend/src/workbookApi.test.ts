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
      zIndex: 1,
      columnCount: 10,
      rowCount: 20,
      cells: {
        A1: { raw: '42' },
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
    const fetchMock = mockFetch(workbook);

    await expect(workbookApi.loadWorkbook()).resolves.toEqual(workbook);

    expect(fetchMock).toHaveBeenCalledWith('/api/workbook', { headers: {} });
  });

  it('creates sheets through the backend mutation endpoint', async () => {
    const fetchMock = mockFetch({ ok: true, workbook });

    await expect(
      workbookApi.createSheet({ id: 'sheet-1', name: 'Inputs', position: { x: 12, y: 24 } }),
    ).resolves.toEqual(workbook);

    expect(fetchMock).toHaveBeenCalledWith('/api/sheets', {
      method: 'POST',
      body: JSON.stringify({ id: 'sheet-1', name: 'Inputs', position: { x: 12, y: 24 } }),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('keeps local-only sheet fields out of the sheet creation request body', async () => {
    const fetchMock = mockFetch({ ok: true, workbook });

    await workbookApi.createSheet(workbook.sheets[0]);

    expect(fetchMock).toHaveBeenCalledWith('/api/sheets', {
      method: 'POST',
      body: JSON.stringify({ id: 'sheet-1', name: 'Inputs', position: { x: 12, y: 24 }, zIndex: 1 }),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('exposes sheet rename position and z-order update calls', async () => {
    const fetchMock = mockFetch({ ok: true, workbook });

    await workbookApi.renameSheet('sheet-1', 'Renamed');
    await workbookApi.updateSheetPosition('sheet-1', { x: 48, y: 96 });
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
      body: JSON.stringify({ zIndex: 3 }),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('exposes cell content, row append, and column append update calls', async () => {
    const fetchMock = mockFetch({ ok: true, workbook });

    await workbookApi.updateCellContent('sheet 1', 'A1', '=SUM(B1:B2)');
    await workbookApi.appendRow('sheet 1');
    await workbookApi.appendColumn('sheet 1');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sheets/sheet%201/cells/A1', {
      method: 'PUT',
      body: JSON.stringify({ raw: '=SUM(B1:B2)' }),
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
    const fetchMock = mockFetch({ ok: true, workbook });

    await workbookApi.updateCellContent('sheet-1', 'A1', 'Value', { revision: 7 });
    await workbookApi.appendRow('sheet-1', { revision: 8 });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sheets/sheet-1/cells/A1', {
      method: 'PUT',
      body: JSON.stringify({ raw: 'Value' }),
      headers: { 'Content-Type': 'application/json', 'If-Match': '7' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/sheets/sheet-1/rows', {
      method: 'POST',
      headers: { 'If-Match': '8' },
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
