import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument } from '@test-support/workbookFactories';
import { decodeSheetDocument, type SheetDocumentResponse } from './workbookApi';

const source = sheetDocument({ id: 'sheet', name: 'Sheet' });
const document: SheetDocumentResponse = { ...source, content: { ...source.content, cells: [] } };
const row = document.content.rows[0], column = document.content.columns[0];
const cell = cellIdentityKey({ rowId: row, columnId: column });
const decode = (formatOverrides: unknown) => decodeSheetDocument({ ...document, presentation: { ...document.presentation, formatOverrides } } as SheetDocumentResponse);

describe('sparse appearance decoding', () => {
  it('accepts an omitted overrides property and normalizes independently omitted scopes', () => {
    expect(decodeSheetDocument(document).presentation.formatOverrides).toBeUndefined();
    const rows = { [row]: { numberFormat: { kind: 'number', precision: 2 }, fontWeight: 'bold' } };
    const columns = { [column]: { horizontalAlignment: 'general', textColor: 'automatic' } };
    const cells = { [cell]: { fillColor: '#abcdef', fontWeight: 'normal' } };
    for (const input of [{}, { rows }, { columns }, { cells }, { rows, cells, columns: {} }, { rows, columns, cells }]) {
      const before = structuredClone(input);
      const result = decode(input).presentation.formatOverrides;
      expect(result).toEqual({ rows: {}, columns: {}, cells: {}, ...input });
      expect(input).toEqual(before);
      for (const scope of ['rows', 'columns', 'cells'] as const) {
        if (scope in input) expect(result?.[scope]).not.toBe(input[scope]);
      }
    }
  });

  it('rejects malformed present values and identities even with omitted siblings', () => {
    for (const input of [null, [], 1, 'bad', ...['rows', 'columns', 'cells'].flatMap((scope) => [null, [], 1, 'bad'].map((value) => ({ [scope]: value }))),
      { rows: { [row]: null } }, { columns: { [column]: [] } }, { cells: { [cell]: { fontWeight: 'invalid' } } },
      { rows: { foreign: {} } }, { columns: { foreign: {} } }, { cells: { malformed: {} } },
      { cells: { [cellIdentityKey({ rowId: 'foreign', columnId: column })]: {} } },
      { cells: { [cellIdentityKey({ rowId: row, columnId: 'foreign' })]: {} } },
    ]) expect(() => decode(input)).toThrow(/Invalid workbook read contract/);
  });
});
