import { afterEach, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { encodeWorkbookBundle, workbookApi } from './workbookApi';

const operationId = '76e2882d-7ff5-4b17-a7aa-512587ddf933';
const transitionId = 'dd36b1da-89af-4d7d-b81e-17a9c426f6e4';
const workbook = workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Sheet', rowCount: 1, columnCount: 1 })]);
const receipt = () => ({ operationId, transitionId, alreadyCommitted: false, workbook: encodeWorkbookBundle(workbook) });

afterEach(() => vi.unstubAllGlobals());

it('sends the admission operation identity and decodes its authority and workbook', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(receipt()), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const result = await workbookApi.admitModelLifecycle(operationId, workbook, workbook);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ operationId, before: encodeWorkbookBundle(workbook), after: encodeWorkbookBundle(workbook) });
  expect(result).toEqual({ ...receipt(), workbook: { ...workbook, dataModels: {}, functions: [] } });
});

it('sends replay authority and direction and accepts a retry receipt', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...receipt(), alreadyCommitted: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const result = await workbookApi.replayModelLifecycle(operationId, transitionId, 'undo');
  expect(fetch).toHaveBeenCalledWith(`/api/workbook/model-lifecycle/${transitionId}/replay`, expect.objectContaining({ method: 'POST' }));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ operationId, direction: 'undo' });
  expect(result.alreadyCommitted).toBe(true);
});

it('preserves function declarations and trusted bindings in proposals and receipts', async () => {
  const functions: NonNullable<typeof workbook.functions> = [{ identity: 'lineage', name: 'F', parameters: [], body: '=1', bodyBindings: { sheet: '=1' as never } }];
  const withFunctions = { ...workbook, functions };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...receipt(), workbook: encodeWorkbookBundle(withFunctions) }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const result = await workbookApi.admitModelLifecycle(operationId, withFunctions, withFunctions);
  expect(JSON.parse(fetch.mock.calls[0][1].body).after.functions).toEqual(functions);
  expect(result.workbook.functions).toEqual(functions);
});

it.each([
  { operationId: 'other' }, { transitionId: 'forged' }, { transitionId: 'd01f3394-e580-4af0-a0fc-9eb10a748925' },
  { alreadyCommitted: 'true' }, { workbook: null },
])('rejects an invalid replay receipt: %j', async (change) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...receipt(), ...change }), { status: 200 })));
  await expect(workbookApi.replayModelLifecycle(operationId, transitionId, 'redo')).rejects.toThrow('Invalid lifecycle receipt.');
});

it.each([
  { transitionId: undefined }, { transitionId: 'not-a-uuid' }, { operationId: 'wrong' },
  { alreadyCommitted: 1 }, { workbook: null },
  { workbook: { ...encodeWorkbookBundle(workbook), manifest: { ...workbook.manifest, revision: -1 } } },
  { workbook: { ...encodeWorkbookBundle(workbook), functions: [{ name: 'F', parameters: [], body: '1', bodyBindings: { sheet: 3 } }] } },
  { workbook: { ...encodeWorkbookBundle(workbook), functions: [{ name: 'F', parameters: [{ name: 'x', type: 'invalid' }], body: '1' }] } },
])('rejects an unusable admission receipt: %j', async (change) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...receipt(), ...change }), { status: 200 })));
  await expect(workbookApi.admitModelLifecycle(operationId, workbook, workbook)).rejects.toThrow();
});
