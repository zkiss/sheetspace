import { afterEach, expect, it, vi } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { encodeWorkbookBundle, workbookApi } from './workbookApi';

afterEach(() => vi.unstubAllGlobals());

it('captures deletion with a guarded workbook and induced row orders', async () => {
  const sheet = sheetDocument({ id: 'first', name: 'First', rowCount: 2, columnCount: 1 });
  const before = workbookWithSheets([sheet]);
  const request = { operationId: 'op', before, rowOrders: [{ sheetId: sheet.id, order: [sheet.content.rows[0]!] }] };
  const response = { operationId: 'op', deletionId: 'deletion', rowId: 'row', alreadyCommitted: false, workbook: encodeWorkbookBundle(before) };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
  vi.stubGlobal('fetch', fetch);
  const result = await workbookApi.deleteRecord('first', 'row', request);
  expect(result).toEqual({ ...response, workbook: { ...before, dataModels: {} } });
  expect(fetch).toHaveBeenCalledWith('/api/sheets/first/records/row/deletions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, before: encodeWorkbookBundle(before) }),
  });
});

it.each(['undo', 'redo'] as const)('replays deletion authority with a guarded %s request', async (direction) => {
  const before = workbookWithSheets([]);
  const request = { operationId: 'op', direction, before };
  const response = { operationId: 'op', deletionId: 'authority', rowId: 'row', alreadyCommitted: true, workbook: encodeWorkbookBundle(before) };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
  vi.stubGlobal('fetch', fetch);
  const result = await workbookApi.replayRecordDeletion('first', 'row', 'authority', request);
  expect(result).toEqual({ ...response, workbook: { ...before, dataModels: {} } });
  expect(fetch).toHaveBeenCalledWith('/api/sheets/first/records/row/deletions/authority/replay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, before: encodeWorkbookBundle(before) }),
  });
});
