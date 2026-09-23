import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { FormatWrite } from '@workbook/core/model';
import { decodeSheetDocument, workbookApi, type SheetDocumentResponse } from './workbookApi';
import { WorkbookOutbox } from './workbookOutbox';
import { WorkbookPersistenceTransport } from './workbookPersistenceTransport';
import { sheetDocument } from '@test-support/workbookFactories';

const source = sheetDocument({ id: 'sheet-formats', name: 'Formats' });
const document: SheetDocumentResponse = { ...source, content: { ...source.content, cells: [] } };
const row = document.content.rows[0], column = document.content.columns[0];
const cell = cellIdentityKey({ rowId: row, columnId: column });
const writes: FormatWrite[] = [{ scope: 'row', targetId: row, numberFormat: { kind: 'general' } }, { scope: 'cell', targetId: cell, numberFormat: null }];
const intent = { kind: 'write-number-formats' as const, sheetId: document.id, writes };
afterEach(() => vi.unstubAllGlobals());

describe('number format presentation persistence', () => {
  it('sends format writes with a revision and decodes copied format maps', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sheetId: document.id, revision: 8 })));
    vi.stubGlobal('fetch', fetchMock);
    await workbookApi.writeNumberFormats('sheet /1', writes, { revision: 7 });
    expect(fetchMock).toHaveBeenCalledWith('/api/sheets/sheet%20%2F1/presentation', { method: 'PATCH', body: JSON.stringify({ formatWrites: writes }), headers: { 'Content-Type': 'application/json', 'If-Match': '7' } });
    const response = { ...document, presentation: { ...document.presentation, formatOverrides: { rows: { [row]: { numberFormat: { kind: 'general' as const } } }, columns: {}, cells: {} } } };
    const decoded = decodeSheetDocument(response);
    expect(decoded.presentation.formatOverrides).toEqual(response.presentation.formatOverrides);
    expect(decoded.presentation.formatOverrides?.rows).not.toBe(response.presentation.formatOverrides.rows);
    expect(() => decodeSheetDocument({ ...document, presentation: { ...document.presentation, formatOverrides: { rows: [], columns: {}, cells: {} } } } as unknown as SheetDocumentResponse)).toThrow(/Invalid workbook read contract/);
    const validFormat = { numberFormat: { kind: 'general' as const } };
    for (const overrides of [
      { rows: { foreign: validFormat }, columns: {}, cells: {} },
      { rows: {}, columns: { foreign: validFormat }, cells: {} },
      { rows: {}, columns: {}, cells: { malformed: validFormat } },
      { rows: {}, columns: {}, cells: { [cellIdentityKey({ rowId: 'foreign', columnId: column })]: validFormat } },
      { rows: {}, columns: {}, cells: { [cellIdentityKey({ rowId: row, columnId: 'foreign' })]: validFormat } },
    ]) {
      expect(() => decodeSheetDocument({ ...document, presentation: { ...document.presentation, formatOverrides: overrides } } as unknown as SheetDocumentResponse)).toThrow(/Invalid workbook read contract/);
    }
  });

  it('clones, orders, retains, and retries format-write payloads through transport', async () => {
    const outbox = new WorkbookOutbox();
    outbox.enqueue('one', intent);
    writes[0].numberFormat = { kind: 'percent', precision: 9 };
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ sheetId: document.id, revision: 4 }).mockResolvedValueOnce({ sheetId: document.id, revision: 5 });
    const transport = new WorkbookPersistenceTransport({ writeNumberFormats: save });
    transport.recordRevision(document.id, 3);
    expect((await outbox.executeNext(transport))?.status).toBe('failed');
    expect(await outbox.executeNext(transport)).toBeUndefined();
    outbox.retry('one');
    await outbox.executeNext(transport);
    outbox.enqueue('two', { ...intent, writes: [{ scope: 'column', targetId: column, numberFormat: { kind: 'number', precision: 2 } }] });
    await outbox.executeNext(transport);
    expect(save).toHaveBeenNthCalledWith(2, document.id, [{ scope: 'row', targetId: row, numberFormat: { kind: 'general' } }, { scope: 'cell', targetId: cell, numberFormat: null }], { revision: 3 });
    expect(save).toHaveBeenNthCalledWith(3, document.id, [{ scope: 'column', targetId: column, numberFormat: { kind: 'number', precision: 2 } }], { revision: 4 });
    expect(transport.revision(document.id)).toBe(5);
  });
});
