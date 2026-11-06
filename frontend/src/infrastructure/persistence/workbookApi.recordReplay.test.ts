import { afterEach, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { encodeWorkbookBundle, workbookApi } from './workbookApi';

afterEach(() => vi.unstubAllGlobals());

it.each(['undo', 'redo'] as const)('serializes the full guard and decodes %s replay', async (direction) => {
  const first = sheetDocument({ id: 'first', name: 'First', rowCount: 2, columnCount: 1 });
  const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 2, columnCount: 1 });
  const before = workbookWithSheets([first, second]);
  const request = { operationId: 'operation', direction, before };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ operationId: 'operation', rowId: 'row', alreadyCommitted: true, workbook: encodeWorkbookBundle(before) })));
  vi.stubGlobal('fetch', fetch);
  const result = await workbookApi.replayRecord('first', 'row', request);
  expect(result.workbook).toEqual({ ...before, dataModels: {} });
  expect(fetch).toHaveBeenCalledWith('/api/sheets/first/records/row/replay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, before: encodeWorkbookBundle(before) }),
  });
});

it('preserves conflict context', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'sheet-not-found', sheetId: 'other' }), { status: 404 })));
  await expect(workbookApi.replayRecord('first', 'row', { operationId: 'op', direction: 'undo', before: workbookWithSheets([]) }))
    .rejects.toMatchObject({ code: 'sheet-not-found', context: { sheetId: 'other' } });
});

it('preserves canonical identity formula and both recorded row orders', async () => {
  const { cellIdentityKey } = await import('@workbook/core/cellIdentity');
  const { prepareUserFormula } = await import('@workbook/formula/formulaPreparation');
  const first = sheetDocument({ id: 'first', name: 'First', rowCount: 2, columnCount: 2 });
  const second = sheetDocument({ id: 'second', name: 'Second', rowCount: 2, columnCount: 1 });
  const original = workbookWithSheets([first, second]);
  const formula = prepareUserFormula('=@A[2]*2', original, first.id);
  const key = cellIdentityKey({ rowId: first.content.rows[1]!, columnId: first.content.columns[1]! });
  const sorted = { ...first, content: { ...first.content, rows: [...first.content.rows].reverse(), cells: { [key]: formula } } };
  const guard = workbookWithSheets([sorted, { ...second, content: { ...second.content, rows: [...second.content.rows].reverse() } }]);
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ operationId: 'op', rowId: first.content.rows[1], alreadyCommitted: false, workbook: encodeWorkbookBundle(guard) })));
  vi.stubGlobal('fetch', fetch);
  const result = await workbookApi.replayRecord('first', first.content.rows[1]!, { operationId: 'op', direction: 'undo', before: guard });
  const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(body.before.documents[0].content.cells[0].content).toBe(formula);
  expect(body.before.documents.map((sheet: { content: { rows: string[] } }) => sheet.content.rows)).toEqual([sorted.content.rows, [...second.content.rows].reverse()]);
  expect(result.workbook.documents.first!.content.cells[key]).toBe(formula);
});
