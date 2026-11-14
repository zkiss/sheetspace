import { afterEach, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { decodeWorkbookBundle, encodeWorkbookBundle, workbookApi } from './workbookApi';
import { decodeSheetCreationReceipt } from './sheetCreationReceipt';

const operationId = '76e2882d-7ff5-4b17-a7aa-512587ddf933';
const workbook = workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 })]);
const functions = [
  { name: 'Zero', parameters: [], body: '=broken(', bodyBindings: { sheet: '=broken(' as never }, identity: 'lineage' },
  { name: 'Many', parameters: ['int', 'float', 'string', 'boolean'].map((type, i) => ({ name: `p${i}`, type: type as 'int' | 'float' | 'string' | 'boolean' })), body: '=p0', bodyBindings: { sheet: '=p0' as never }, identity: 'other' },
];
const saved = { ...workbook, functions };
afterEach(() => vi.unstubAllGlobals());

it('loads declarations and exact bound content', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(encodeWorkbookBundle(saved)))));
  expect((await workbookApi.loadWorkbook()).functions).toEqual(functions);
});

it('rejects a successful load missing function state', async () => {
  const truncated = { ...encodeWorkbookBundle(saved), functions: undefined };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(truncated))));
  await expect(workbookApi.loadWorkbook()).rejects.toThrow('invalid function declarations');
});

it('sends declarations without trusted state and decodes the authoritative receipt', async () => {
  const receipt = { operationId, committedIdentity: 'lineage', alreadyCommitted: false, workbook: encodeWorkbookBundle(saved) };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(receipt)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...receipt, workbook: encodeWorkbookBundle({ ...saved, functions: [functions[1]] }) })));
  vi.stubGlobal('fetch', fetch);
  expect((await workbookApi.setFunction(operationId, saved, functions[0], 'Zero')).workbook.functions).toEqual(functions);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ operationId, before: encodeWorkbookBundle(saved), declaration: { name: 'Zero', parameters: [], body: '=broken(' }, previousName: 'Zero' });
  await workbookApi.deleteFunction(operationId, saved, 'Zero');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ operationId, before: encodeWorkbookBundle(saved), name: 'Zero' });
});

it.each([{ name: 'F', parameters: [], body: 'x', identity: 1 }, { name: 'F', parameters: [], body: 'x', bodyBindings: { sheet: 1 } }])('rejects malformed function state on ordinary load', async (invalid) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...encodeWorkbookBundle(workbook), functions: [invalid] }))));
  await expect(workbookApi.loadWorkbook()).rejects.toThrow('invalid function declarations');
});

it.each([
  [{ ...functions[0], identity: undefined }],
  [{ ...functions[0], identity: null }],
  [{ ...functions[0], identity: '  ' }],
  [null],
  [[]],
  [{ ...functions[0], parameters: [null] }],
  [{ ...functions[0], parameters: [[]] }],
  [{ ...functions[0], parameters: [{ name: 'x', type: 'date' }] }],
  [{ ...functions[0], parameters: [{ name: 'TRUE', type: 'int' }] }],
  [{ ...functions[0], body: null }],
  [{ ...functions[0], bodyBindings: null }],
  [{ ...functions[0], bodyBindings: [] }],
  [{ ...functions[0], bodyBindings: { sheet: '=~{oops}' } }],
  [{ ...functions[0], bodyBindings: { sheet: 'not canonical' } }],
  [{ ...functions[0], bodyBindings: { missing: '=1' } }],
  [{ ...functions[0], bodyBindings: {} }],
  [{ ...functions[0], identity: '' }],
  [functions[0], { ...functions[1], identity: functions[0].identity }],
  [functions[0], { ...functions[1], name: 'zero' }],
  [{ ...functions[0], name: 'SUM' }],
  [{ ...functions[0], name: '1bad' }],
  [{ ...functions[0], parameters: [{ name: 'a', type: 'int' }, { name: 'A', type: 'int' }] }],
])('rejects incoherent durable functions in load and mutation responses', async (...invalid) => {
  const bundle = { ...encodeWorkbookBundle(workbook), functions: invalid };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(bundle)))
    .mockImplementation(async () => new Response(JSON.stringify({ operationId, committedIdentity: 'lineage', alreadyCommitted: false, workbook: bundle })));
  vi.stubGlobal('fetch', fetch);
  await expect(workbookApi.loadWorkbook()).rejects.toThrow('invalid function declarations');
  await expect(workbookApi.setFunction(operationId, workbook, functions[0])).rejects.toThrow();
  await expect(workbookApi.deleteFunction(operationId, workbook, 'Zero')).rejects.toThrow();
});

it.each([undefined, null, {}, 'bad'])('rejects non-array authoritative function lists', (invalid) => {
  expect(() => decodeWorkbookBundle({ ...encodeWorkbookBundle(workbook), functions: invalid } as never)).toThrow('invalid function declarations');
});

it('preserves opaque and malformed bodies without regenerating bindings', () => {
  const original = { ...saved, functions: [
    { name: 'F', parameters: [], body: '=broken(', identity: 'opaque lineage', bodyBindings: { sheet: '=~{0061}+"~{oops}"' as never } },
    { name: 'G', parameters: [], body: '', identity: 'second' },
  ] };
  const decoded = decodeWorkbookBundle(encodeWorkbookBundle(original));
  expect(decoded.functions).toEqual(original.functions);
  expect(decoded.functions).not.toBe(original.functions);
  expect(decoded.functions![0].bodyBindings).not.toBe(original.functions[0].bodyBindings);
});

it('requires every authoritative caller binding but accepts a zero-sheet formula', () => {
  const second = sheetDocument({ id: 'second', name: 'Second' });
  const bundle = encodeWorkbookBundle({ ...workbookWithSheets([second, workbook.documents.sheet]), functions });
  expect(() => decodeWorkbookBundle(bundle)).toThrow('invalid function declarations');
  const complete = { ...bundle, functions: functions.map((fn) => ({ ...fn, bodyBindings: { ...fn.bodyBindings, second: '=~{0061}' as never } })) };
  expect(decodeWorkbookBundle(complete).functions).toEqual(complete.functions);
  const empty = encodeWorkbookBundle({ ...workbookWithSheets([]), functions: [{ ...functions[0], bodyBindings: undefined }] });
  expect(decodeWorkbookBundle(empty).functions).toEqual(empty.functions);
  expect(decodeWorkbookBundle({ ...empty, functions: [] }).functions).toEqual([]);
});

it('rejects missing lineage and function state in creation responses', async () => {
  const bundle = encodeWorkbookBundle(saved);
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sheetId: 'sheet', workbook: { ...bundle, functions: [{ ...functions[0], identity: undefined }] } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ sheetId: 'sheet', workbook: { ...bundle, functions: undefined } })));
  vi.stubGlobal('fetch', fetch);
  const request = { name: 'Sheet', position: { x: 1, y: 2 } };
  await expect(workbookApi.createSheet(request)).rejects.toThrow();
  await expect(workbookApi.createSheet(request)).rejects.toThrow();
});

it('decodes the atomic creation snapshot without changing function bindings', () => {
  const receipt = decodeSheetCreationReceipt({ sheetId: 'sheet', workbook: encodeWorkbookBundle(saved) }, decodeWorkbookBundle);
  expect(receipt).toEqual({ sheetId: 'sheet', workbook: { ...saved, dataModels: {} } });
  expect(receipt.workbook.functions).not.toBe(saved.functions);
});

it('rejects creation receipts with a missing created sheet or invalid revisions', () => {
  const bundle = encodeWorkbookBundle(saved);
  expect(() => decodeSheetCreationReceipt({ sheetId: 'missing', workbook: bundle }, decodeWorkbookBundle)).toThrow('Invalid sheet creation receipt');
  expect(() => decodeSheetCreationReceipt({ sheetId: 'sheet', workbook: { ...bundle, manifest: { ...bundle.manifest, revision: -1 } } }, decodeWorkbookBundle)).toThrow('Invalid sheet creation receipt');
});

it('decodes the POST creation response and rejects malformed success', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ sheetId: 'sheet', workbook: encodeWorkbookBundle(saved) })))
    .mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  expect((await workbookApi.createSheet({ name: 'Sheet', position: { x: 1, y: 2 } })).workbook.functions).toEqual(functions);
  expect(fetch).toHaveBeenCalledWith('/api/sheets', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Sheet', position: { x: 1, y: 2 } }) }));
  await expect(workbookApi.createSheet({ name: 'Sheet', position: { x: 1, y: 2 } })).rejects.toThrow();
});
