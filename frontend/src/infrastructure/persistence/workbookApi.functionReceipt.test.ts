import { afterEach, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { encodeWorkbookBundle, workbookApi } from './workbookApi';

const operationId = '76e2882d-7ff5-4b17-a7aa-512587ddf933';
const workbook = workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Sheet' })]);
const declaration = { name: 'F', parameters: [], body: '=broken(' };
const receipt = () => ({ operationId, committedIdentity: 'historical', alreadyCommitted: true, workbook: encodeWorkbookBundle(workbook) });
afterEach(() => vi.unstubAllGlobals());

it.each(['create', 'edit', 'rename', 'delete'])('reuses the exact %s request after an ambiguous response', async (kind) => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValue(new Response(JSON.stringify(receipt())));
  vi.stubGlobal('fetch', fetch);
  const before = kind === 'create' ? workbook : { ...workbook, functions: [{ ...declaration, identity: 'historical', bodyBindings: { sheet: '=broken(' as never } }] };
  const send = () => kind === 'delete' ? workbookApi.deleteFunction(operationId, before, 'F')
    : workbookApi.setFunction(operationId, before, { ...declaration, name: kind === 'rename' ? 'G' : 'F' }, kind === 'create' ? undefined : 'F');
  await expect(send()).rejects.toThrow('lost response');
  const result = await send();
  expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
  expect(result).toMatchObject({ operationId, committedIdentity: 'historical', alreadyCommitted: true });
  expect(result.workbook.functions).toEqual([]);
});

it('reports historical identity separately from a reused current name', async () => {
  const current = { ...workbook, functions: [{ ...declaration, identity: 'new', bodyBindings: { sheet: '=broken(' as never } }] };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...receipt(), workbook: encodeWorkbookBundle(current) }))));
  const result = await workbookApi.setFunction(operationId, workbook, declaration);
  expect(result.committedIdentity).toBe('historical');
  expect(result.workbook.functions).toEqual(current.functions);
});

it.each([
  { functions: [] },
  { functions: [{ ...declaration, identity: 'different', bodyBindings: { sheet: '=broken(' as never } }] },
  { functions: [{ ...declaration, body: '=1', identity: 'historical', bodyBindings: { sheet: '=1' as never } }] },
  { functions: [{ ...declaration, parameters: [{ name: 'x', type: 'int' as const }], identity: 'historical', bodyBindings: { sheet: '=broken(' as never } }] },
])('rejects a first set receipt without the submitted declaration and identity: %j', async (change) => {
  const response = { ...receipt(), alreadyCommitted: false, workbook: encodeWorkbookBundle({ ...workbook, ...change }) };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
  await expect(workbookApi.setFunction(operationId, workbook, declaration)).rejects.toThrow('Invalid function receipt.');
});

it('rejects a first delete receipt whose identity does not match the target in before', async () => {
  const before = { ...workbook, functions: [{ ...declaration, identity: 'original', bodyBindings: { sheet: '=broken(' as never } }] };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...receipt(), alreadyCommitted: false }))));
  await expect(workbookApi.deleteFunction(operationId, before, 'F')).rejects.toThrow('Invalid function receipt.');
  await expect(workbookApi.deleteFunction(operationId, workbook, 'F')).rejects.toThrow('Invalid function receipt.');
});

it.each([
  null, { operationId: undefined }, { committedIdentity: undefined }, { alreadyCommitted: undefined }, { operationId: 'wrong' }, { operationId: 'd01f3394-e580-4af0-a0fc-9eb10a748925' },
  { committedIdentity: '' }, { committedIdentity: '  ' }, { committedIdentity: 3 },
  { alreadyCommitted: 'true' }, { workbook: null },
  { workbook: { ...encodeWorkbookBundle(workbook), manifest: { ...workbook.manifest, revision: -1 } } },
])('rejects invalid acknowledgement metadata or workbook: %j', async (change) => {
  const response = change === null ? null : { ...receipt(), ...change };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
  await expect(workbookApi.setFunction(operationId, workbook, declaration)).rejects.toThrow();
});

it('rejects an invalid submitted identity even if echoed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...receipt(), operationId: 'wrong' }))));
  await expect(workbookApi.setFunction('wrong', workbook, declaration)).rejects.toThrow('Invalid function receipt.');
});
