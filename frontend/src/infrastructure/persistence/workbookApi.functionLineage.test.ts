import type { Workbook } from '@workbook/core/model';
import { afterEach, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { encodeWorkbookBundle, workbookApi } from './workbookApi';

const operationId = '76e2882d-7ff5-4b17-a7aa-512587ddf933';
const base = workbookWithSheets([sheetDocument({ id: 'sheet', name: 'Sheet' })]);
const original = { name: 'F', body: '=x', parameters: [{ name: 'x', type: 'int' as const }], identity: 'old', bodyBindings: { sheet: '=x' as never } };
const other = { ...original, name: 'Other', identity: 'other' };
const before = { ...base, functions: [original, other] };
const response = (functions: NonNullable<Workbook['functions']>, identity: string, alreadyCommitted: boolean) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ operationId, committedIdentity: identity, alreadyCommitted, workbook: encodeWorkbookBundle({ ...base, functions }) }))));
};
afterEach(() => vi.unstubAllGlobals());

const edits = [
  { label: 'no-op', declaration: original, identity: 'old' },
  { label: 'rename', declaration: { ...original, name: 'G' }, identity: 'old' },
  { label: 'type-only', declaration: { ...original, parameters: [{ name: 'x', type: 'float' as const }] }, identity: 'old' },
  { label: 'body', declaration: { ...original, body: '=2', bodyBindings: { sheet: '=2' as never } }, identity: 'new' },
  { label: 'parameter name', declaration: { ...original, parameters: [{ name: 'y', type: 'int' as const }] }, identity: 'new' },
  { label: 'parameter count', declaration: { ...original, parameters: [] }, identity: 'new' },
  { label: 'rename and body', declaration: { ...original, name: 'G', body: '=2', bodyBindings: { sheet: '=2' as never } }, identity: 'new' },
];

it.each(edits)('accepts first and duplicate $label with the correct lineage', async ({ declaration, identity }) => {
  response([{ ...declaration, identity }, other], identity, false);
  await expect(workbookApi.setFunction(operationId, before, declaration, 'f')).resolves.toMatchObject({ committedIdentity: identity });
  response([{ ...original, identity: 'replacement', body: '=3', bodyBindings: { sheet: '=3' as never } }], identity, true);
  await expect(workbookApi.setFunction(operationId, before, declaration, 'F')).resolves.toMatchObject({ alreadyCommitted: true });
});

it.each(edits.flatMap((edit) => [false, true].map((duplicate) => ({ ...edit, duplicate }))))('rejects invalid $label lineage on duplicate=$duplicate', async ({ declaration, identity, duplicate }) => {
  response([{ ...declaration, identity: identity === 'old' ? 'wrong' : 'other' }], identity === 'old' ? 'wrong' : 'other', duplicate);
  await expect(workbookApi.setFunction(operationId, before, declaration, 'F')).rejects.toThrow('Invalid function receipt');
});

it.each([false, true])('rejects missing old targets and reused create lineage on duplicate=%s', async (duplicate) => {
  response([], 'old', duplicate);
  await expect(workbookApi.setFunction(operationId, before, original, 'missing')).rejects.toThrow('Invalid function receipt');
  await expect(workbookApi.deleteFunction(operationId, before, 'missing')).rejects.toThrow('Invalid function receipt');
  await expect(workbookApi.setFunction(operationId, before, original)).rejects.toThrow('Invalid function receipt');
});

it.each([false, true])('validates delete lineage independently of current state on duplicate=%s', async (duplicate) => {
  response(duplicate ? [original, other] : [other], 'old', duplicate);
  await expect(workbookApi.deleteFunction(operationId, before, 'f')).resolves.toMatchObject({ committedIdentity: 'old' });
  response([other], 'wrong', duplicate);
  await expect(workbookApi.deleteFunction(operationId, before, 'F')).rejects.toThrow('Invalid function receipt');
});

it.each([[[original]], [[{ ...original, name: 'f' }]], [[{ ...original, name: 'G' }]]])('rejects first delete retaining the name or lineage', async (functions) => {
  response(functions, 'old', false);
  await expect(workbookApi.deleteFunction(operationId, before, 'F')).rejects.toThrow('Invalid function receipt');
});

it('rejects first rename that also retains the old name', async () => {
  response([{ ...original, name: 'G' }, { ...original, identity: 'replacement' }], 'old', false);
  await expect(workbookApi.setFunction(operationId, before, { ...original, name: 'G' }, 'F')).rejects.toThrow('Invalid function receipt');
});

it.each([
  { ...original, name: 'G' },
  { ...original, parameters: [{ name: 'y', type: 'int' as const }] },
  { ...original, parameters: [{ name: 'x', type: 'float' as const }] },
  { ...original, parameters: [] },
])('rejects first set with a different returned declaration', async (changed) => {
  response([changed], 'old', false);
  await expect(workbookApi.setFunction(operationId, before, original, 'F')).rejects.toThrow('Invalid function receipt');
});

it('rejects reordered parameters in a first result', async () => {
  const declaration = { ...original, parameters: [{ name: 'x', type: 'int' as const }, { name: 'y', type: 'float' as const }] };
  response([{ ...declaration, parameters: [...declaration.parameters].reverse(), identity: 'new' }], 'new', false);
  await expect(workbookApi.setFunction(operationId, before, declaration, 'F')).rejects.toThrow('Invalid function receipt');
});

it('accepts fresh create and duplicate delete after name reuse', async () => {
  response([{ ...original, identity: 'new' }], 'new', false);
  await expect(workbookApi.setFunction(operationId, base, original)).resolves.toMatchObject({ committedIdentity: 'new' });
  response([{ ...original, identity: 'replacement' }], 'old', true);
  await expect(workbookApi.deleteFunction(operationId, before, 'F')).resolves.toMatchObject({ alreadyCommitted: true });
});
