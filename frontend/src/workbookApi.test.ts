import { afterEach, describe, expect, it, vi } from 'vitest';
import workbookReadContract from '../../test-fixtures/workbook-read-contract.json';
import { cellIdentityKey, cellRawContent, sheetsInOrder, type SheetDocument } from './workbook';
import {
  decodeSheetDocument,
  decodeWorkbookBundle,
  workbookApi,
  WorkbookApiError,
  type SheetDocumentResponse,
  type WorkbookBundleResponse,
} from './workbookApi';

const contractFixture = workbookReadContract as WorkbookBundleResponse;
const inputsResponse = contractFixture.documents[1];
const outputsResponse = contractFixture.documents[0];

function expectedDocument(response: SheetDocumentResponse): SheetDocument {
  return {
    id: response.id,
    name: response.name,
    revision: response.revision,
    frame: {
      position: { ...response.frame.position },
      size: { ...response.frame.size },
      zIndex: response.frame.zIndex,
    },
    content: {
      kind: 'tabular',
      rows: [...response.content.rows],
      columns: [...response.content.columns],
      cells: Object.fromEntries(response.content.cells.map((cell) => [
        cellIdentityKey({ rowId: cell.rowId, columnId: cell.columnId }),
        cell.content,
      ])),
    },
  };
}

const inputsDocument = expectedDocument(inputsResponse);
const outputsDocument = expectedDocument(outputsResponse);

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

afterEach(() => vi.unstubAllGlobals());

describe('workbook API read decoding', () => {
  it('loads manifest and stable sheet documents in manifest order', async () => {
    const fetchMock = mockFetch(contractFixture);
    const workbook = await workbookApi.loadWorkbook();

    expect(workbook).toEqual({
      manifest: {
        version: 1,
        revision: 7,
        sheetIds: [outputsDocument.id, inputsDocument.id],
      },
      documents: {
        [outputsDocument.id]: outputsDocument,
        [inputsDocument.id]: inputsDocument,
      },
    });
    expect(sheetsInOrder(workbook).map((sheet) => sheet.name)).toEqual(['Outputs', 'Inputs']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/workbook/bundle', { headers: {} });
  });

  it('preserves row, column, and cell identity while projecting A1 from order', () => {
    const document = decodeSheetDocument(inputsResponse);

    expect(document.content.rows).toEqual(inputsResponse.content.rows);
    expect(document.content.columns).toEqual(inputsResponse.content.columns);
    expect(Object.keys(document.content.cells)).toContain(cellIdentityKey({
      rowId: inputsResponse.content.rows[1],
      columnId: inputsResponse.content.columns[1],
    }));
    expect(cellRawContent(document, 'A1')).toBe('Region');
    expect(cellRawContent(document, 'B2')).toBe('5');
  });

  it('loads one stable sheet document by encoded id', async () => {
    const fetchMock = mockFetch(inputsResponse);
    await expect(workbookApi.loadSheet('sheet 1')).resolves.toEqual(inputsDocument);
    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/sheet%201', { headers: {} });
  });

  it('loads a medium bundle with one request and complete membership', async () => {
    const documents = Array.from({ length: 30 }, (_, index) => ({
      ...outputsResponse,
      id: `sheet-${index}`,
      name: `Sheet ${index}`,
    }));
    mockFetch({
      manifest: { ...contractFixture.manifest, sheetIds: documents.map((document) => document.id) },
      documents,
    });

    const workbook = await workbookApi.loadWorkbook();
    expect(workbook.manifest.sheetIds).toEqual(documents.map((document) => document.id));
    expect(Object.keys(workbook.documents)).toHaveLength(30);
  });

  it.each([
    ['duplicate manifest id', {
      ...contractFixture,
      manifest: { ...contractFixture.manifest, sheetIds: [inputsResponse.id, inputsResponse.id] },
    }],
    ['duplicate document id', {
      ...contractFixture,
      documents: [inputsResponse, inputsResponse],
      manifest: { ...contractFixture.manifest, sheetIds: [inputsResponse.id, outputsResponse.id] },
    }],
    ['missing document', { ...contractFixture, documents: contractFixture.documents.slice(0, 1) }],
    ['unsupported version', {
      ...contractFixture,
      manifest: { ...contractFixture.manifest, version: 2 },
    }],
  ])('rejects %s bundle contracts', (_label, payload) => {
    expect(() => decodeWorkbookBundle(payload as WorkbookBundleResponse)).toThrowError(
      expect.objectContaining({ code: 'invalid-workbook-read-contract' }),
    );
  });

  it.each([
    ['duplicate row id', {
      ...inputsResponse,
      content: { ...inputsResponse.content, rows: [inputsResponse.content.rows[0], inputsResponse.content.rows[0]] },
    }],
    ['duplicate column id', {
      ...inputsResponse,
      content: { ...inputsResponse.content, columns: [inputsResponse.content.columns[0], inputsResponse.content.columns[0]] },
    }],
    ['dangling cell identity', {
      ...inputsResponse,
      content: {
        ...inputsResponse.content,
        cells: [{ rowId: 'missing-row', columnId: inputsResponse.content.columns[0], content: 'x' }],
      },
    }],
    ['duplicate cell identity', {
      ...inputsResponse,
      content: {
        ...inputsResponse.content,
        cells: [inputsResponse.content.cells[0], inputsResponse.content.cells[0]],
      },
    }],
  ])('rejects %s sheet contracts', (_label, payload) => {
    expect(() => decodeSheetDocument(payload as SheetDocumentResponse)).toThrowError(
      expect.objectContaining({ code: 'invalid-workbook-read-contract' }),
    );
  });
});

describe('workbook API mutations', () => {
  it('creates sheets from focused frame input and decodes returned stable document', async () => {
    const fetchMock = mockFetch(inputsResponse);

    await expect(workbookApi.createSheet({
      name: 'Inputs',
      position: { x: 12, y: 24 },
      frameSize: { width: 240, height: 160 },
      zIndex: 1,
    })).resolves.toEqual(inputsDocument);
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

  it('keeps local-only identity and content out of creation requests', async () => {
    const fetchMock = mockFetch(inputsResponse);
    await workbookApi.createSheet({
      id: 'pending:local-only-id',
      name: 'Inputs',
      position: { x: 12, y: 24 },
      content: inputsDocument.content,
    } as Parameters<typeof workbookApi.createSheet>[0]);

    expect(fetchMock).toHaveBeenCalledWith('/api/sheets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Inputs', position: { x: 12, y: 24 } }),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('exposes sheet metadata and frame update calls', async () => {
    const fetchMock = mockFetch({ sheetId: 'sheet-1', revision: 1 });
    await workbookApi.renameSheet('sheet-1', 'Renamed');
    await workbookApi.updateSheetPosition('sheet-1', { x: 48, y: 96 });
    await workbookApi.updateSheetFrameLayout('sheet-1', { x: 48, y: 96 }, { width: 320, height: 220 });
    await workbookApi.updateSheetZOrder([
      { sheetId: 'sheet-1', expectedRevision: 2, zIndex: 3 },
      { sheetId: 'sheet-2', expectedRevision: 4, zIndex: 1 },
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sheets/sheet-1', {
      method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }), headers: { 'Content-Type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/sheets/sheet-1', {
      method: 'PATCH', body: JSON.stringify({ position: { x: 48, y: 96 } }), headers: { 'Content-Type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/sheets/sheet-1', {
      method: 'PATCH',
      body: JSON.stringify({ position: { x: 48, y: 96 }, frameSize: { width: 320, height: 220 } }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/workbook/sheet-z-order', {
      method: 'PATCH',
      body: JSON.stringify({ updates: [
        { sheetId: 'sheet-1', expectedRevision: 2, zIndex: 3 },
        { sheetId: 'sheet-2', expectedRevision: 4, zIndex: 1 },
      ] }),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('deletes sheets with encoded ids and revision tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await workbookApi.deleteSheet('sheet 1', { revision: 3 });
    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/sheet%201', {
      method: 'DELETE', headers: { 'If-Match': '3' },
    });
  });

  it('sends A1 cell content and structure mutations with revision tokens', async () => {
    const fetchMock = mockFetch({ sheetId: 'sheet 1', revision: 1, rowCount: 21, columnCount: 11 });
    await workbookApi.updateCellContent('sheet 1', 'A1', '=SUM(B1:B2)', { revision: 7 });
    await workbookApi.appendRow('sheet 1', { revision: 8 });
    await workbookApi.appendColumn('sheet 1');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sheets/sheet%201/cells/A1', {
      method: 'PUT', body: JSON.stringify('=SUM(B1:B2)'),
      headers: { 'Content-Type': 'application/json', 'If-Match': '7' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/sheets/sheet%201/rows', {
      method: 'POST', headers: { 'If-Match': '8' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/sheets/sheet%201/columns', {
      method: 'POST', headers: {},
    });
  });

  it('throws testable API errors for failed responses', async () => {
    mockFetch({ error: 'sheet-not-found' }, { status: 404 });
    await expect(workbookApi.appendRow('missing')).rejects.toMatchObject({
      name: 'WorkbookApiError', message: 'sheet-not-found', status: 404, code: 'sheet-not-found',
    } satisfies Partial<WorkbookApiError>);
  });
});
