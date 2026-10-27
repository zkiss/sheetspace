import { afterEach, describe, expect, it, vi } from 'vitest';
import workbookReadContract from '../../../../test-fixtures/workbook-read-contract.json';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { cellRawContent, sheetsInOrder } from '@workbook/read/queries';
import { DEFAULT_SHEET_FRAME_SIZE, type SheetDocument } from '@workbook/core/model';
import { formulaRawToCanonical, formulaRawToDisplay, workbookFormulaReferenceResolver } from '@workbook/formula/reference';
import {
  decodeSheetDocument,
  decodeWorkbookBundle,
  workbookApi,
  WorkbookApiError,
  type SheetDocumentResponse,
  type WorkbookBundleResponse,
} from '@infrastructure/persistence/workbookApi';

const contractFixture = workbookReadContract as WorkbookBundleResponse;
const inputsResponse = contractFixture.documents[1];
const outputsResponse = contractFixture.documents[0];

function expectedDocument(response: SheetDocumentResponse): SheetDocument {
  return {
    id: response.id,
    name: response.name,
    revision: response.revision,
    presentation: { rowHeights: { ...response.presentation.rowHeights }, columnWidths: { ...response.presentation.columnWidths } },
    frame: {
      position: { ...response.frame.position },
      size: {
        width: response.frame.size?.width ?? DEFAULT_SHEET_FRAME_SIZE.width,
        height: response.frame.size?.height ?? DEFAULT_SHEET_FRAME_SIZE.height,
      },
      visualScale: response.frame.visualScale,
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
    ...(response.modelId === undefined ? {} : { modelId: response.modelId }),
    ...(response.modelColumnBindings === undefined ? {} : { modelColumnBindings: { ...response.modelColumnBindings } }),
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
      dataModels: {
        '30000000-0000-0000-0000-000000000001': {
          id: '30000000-0000-0000-0000-000000000001',
          name: 'Invoice',
          columns: [
            { id: '31000000-0000-0000-0000-000000000001', name: 'Description', kind: 'manual', type: 'string' },
            { id: '31000000-0000-0000-0000-000000000002', name: 'Quantity', kind: 'manual', type: 'int' },
            { id: '31000000-0000-0000-0000-000000000003', name: 'Rate', kind: 'manual', type: 'float' },
            { id: '31000000-0000-0000-0000-000000000004', name: 'Taxable', kind: 'calculated', type: 'boolean', formula: '=SUM(quantity, tax)' },
          ],
        },
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

  it('decodes canonical formula strings without rewriting persisted content', () => {
    const canonical = "=SUM(@sheet-inputs!$column-a[row-a]:column-b[$row-b], @column-c[row-c])";
    const response: SheetDocumentResponse = {
      ...outputsResponse,
      content: {
        ...outputsResponse.content,
        cells: [{
          rowId: outputsResponse.content.rows[0],
          columnId: outputsResponse.content.columns[0],
          content: canonical,
        }],
      },
    };

    expect(cellRawContent(decodeSheetDocument(response), 'A1')).toBe(canonical);
  });

  it('decodes persisted property bindings for named-reference resolution', () => {
    const modelId = contractFixture.dataModels[0]!.id;
    const propertyId = contractFixture.dataModels[0]!.columns[0]!.id;
    const response = { ...inputsResponse, modelId, modelColumnBindings: { [propertyId]: inputsResponse.content.columns[0]! } };
    const persisted = { ...contractFixture, documents: [outputsResponse, response] };
    const decoded = decodeWorkbookBundle(persisted);
    const resolver = workbookFormulaReferenceResolver(decoded, response.id);
    const canonical = formulaRawToCanonical("=@'Description'[1]", resolver);
    const storedResponse = {
      ...response,
      content: { ...response.content, cells: [{ rowId: response.content.rows[0], columnId: response.content.columns[0], content: canonical }] },
    };
    const reloaded = decodeWorkbookBundle({ ...persisted, documents: [outputsResponse, storedResponse] });

    expect(decodeSheetDocument(response)).toMatchObject({ modelId, modelColumnBindings: response.modelColumnBindings });
    expect(canonical).not.toContain('#REF!');
    expect(canonical).not.toBe("=@'Description'[1]");
    expect(formulaRawToDisplay(cellRawContent(reloaded.documents[response.id]!, 'A1')!, workbookFormulaReferenceResolver(reloaded, response.id)))
      .toBe('=@Description[1]');
  });

  it('fills omitted frame dimensions with the rendered default dimensions', () => {
    const document = decodeSheetDocument({
      ...inputsResponse,
      frame: { ...inputsResponse.frame, size: undefined },
    });

    expect(document.frame.size).toEqual({ width: 240, height: 160 });
  });

  it('loads one stable sheet document by encoded id', async () => {
    const fetchMock = mockFetch(inputsResponse);
    await expect(workbookApi.loadSheet('sheet 1')).resolves.toEqual(inputsDocument);
    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/sheet%201', { headers: {} });
  });

  it('saves model declarations and sheet bindings through narrow metadata endpoints', async () => {
    const model = {
      id: '30000000-0000-0000-0000-000000000001',
      name: 'Invoice',
      columns: [{ id: '31000000-0000-0000-0000-000000000001', name: 'Amount', kind: 'manual' as const, type: 'float' as const }],
    };
    const saveFetch = mockFetch(model);
    await expect(workbookApi.saveDataModel(model)).resolves.toEqual(model);
    expect(saveFetch).toHaveBeenCalledWith(`/api/data-models/${model.id}`, {
      method: 'PUT', body: JSON.stringify({ name: model.name, columns: model.columns }), headers: { 'Content-Type': 'application/json' },
    });

    const bound = { ...inputsResponse, modelId: model.id, modelColumnBindings: { [model.columns[0].id]: inputsResponse.content.columns[0] } };
    const bindingFetch = mockFetch(bound);
    await expect(workbookApi.setSheetModel(inputsResponse.id, model.id)).resolves.toEqual(expectedDocument(bound));
    expect(bindingFetch).toHaveBeenCalledWith(`/api/sheets/${inputsResponse.id}/model`, {
      method: 'PUT', body: JSON.stringify({ modelId: model.id }), headers: { 'Content-Type': 'application/json' },
    });
    await expect(workbookApi.setSheetModel(inputsResponse.id, model.id, bound.modelColumnBindings)).resolves.toEqual(expectedDocument(bound));
    expect(bindingFetch).toHaveBeenLastCalledWith(`/api/sheets/${inputsResponse.id}/model`, {
      method: 'PUT', body: JSON.stringify({ modelId: model.id, modelColumnBindings: bound.modelColumnBindings }), headers: { 'Content-Type': 'application/json' },
    });
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
      dataModels: contractFixture.dataModels,
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
    ['duplicate data model id', {
      ...contractFixture,
      dataModels: [contractFixture.dataModels[0], contractFixture.dataModels[0]],
    }],
    ['dangling sheet model id', {
      ...contractFixture,
      documents: [{ ...outputsResponse, modelId: 'missing-model' }, inputsResponse],
    }],
    ['unknown bound property', {
      ...contractFixture,
      documents: [{ ...outputsResponse, modelId: contractFixture.dataModels[0]!.id, modelColumnBindings: { missing: outputsResponse.content.columns[0] } }, inputsResponse],
    }],
    ['duplicate bound column', {
      ...contractFixture,
      documents: [{ ...outputsResponse, modelId: contractFixture.dataModels[0]!.id, modelColumnBindings: {
        [contractFixture.dataModels[0]!.columns[0]!.id]: outputsResponse.content.columns[0],
        [contractFixture.dataModels[0]!.columns[1]!.id]: outputsResponse.content.columns[0],
      } }, inputsResponse],
    }],
  ])('rejects %s bundle contracts', (_label, payload) => {
    expect(() => decodeWorkbookBundle(payload as WorkbookBundleResponse)).toThrowError(
      expect.objectContaining({ code: 'invalid-workbook-read-contract' }),
    );
  });

  it.each([
    null, [], 'invalid', { '': inputsResponse.content.columns[0] }, { property: 42 }, { property: '' },
  ])('rejects invalid property binding shape %j', (modelColumnBindings) => {
    expect(() => decodeSheetDocument({ ...inputsResponse, modelColumnBindings } as unknown as SheetDocumentResponse))
      .toThrowError(expect.objectContaining({ code: 'invalid-workbook-read-contract' }));
  });

  it.each([
    ['bindings without a model', { ...inputsResponse, modelId: undefined, modelColumnBindings: { property: inputsResponse.content.columns[0] } }],
    ['unknown bound column', { ...inputsResponse, modelId: contractFixture.dataModels[0].id, modelColumnBindings: { property: 'missing' } }],
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

  it.each([0, -1, Number.POSITIVE_INFINITY, 8.1])('rejects invalid sheet visual scale %s', (visualScale) => {
    expect(() => decodeSheetDocument({
      ...inputsResponse,
      frame: { ...inputsResponse.frame, visualScale },
    } as SheetDocumentResponse)).toThrowError(expect.objectContaining({ code: 'invalid-workbook-read-contract' }));
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
    await workbookApi.updateSheetVisualScale('sheet-1', 0.5);
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
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/sheets/sheet-1', {
      method: 'PATCH', body: JSON.stringify({ visualScale: 0.5 }), headers: { 'Content-Type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/workbook/sheet-z-order', {
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

  it('sends stable-identity cell patches and structure mutations', async () => {
    const fetchMock = mockFetch({
      sheetId: 'sheet 1', revision: 1, rowCount: 21, columnCount: 11, rowId: 'row-21', columnId: 'column-11',
    });
    await workbookApi.writeCells(
      [{ sheetId: 'sheet 1', revision: 7 }],
      [{ sheetId: 'sheet 1', rowId: 'row-1', columnId: 'column-1', raw: '=SUM(@B[1]:B[2])' }],
    );
    const row = await workbookApi.appendRow('sheet 1', { revision: 8 });
    const column = await workbookApi.appendColumn('sheet 1');

    expect(row.rowId).toBe('row-21');
    expect(column.columnId).toBe('column-11');


    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/cells', {
      method: 'PATCH', body: JSON.stringify({
        expectedRevisions: [{ sheetId: 'sheet 1', revision: 7 }],
        cells: [{ sheetId: 'sheet 1', rowId: 'row-1', columnId: 'column-1', raw: '=SUM(@B[1]:B[2])' }],
      }),
      headers: { 'Content-Type': 'application/json' },
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
