import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument } from '@test-support/workbookFactories';
import { selectionFormatControlState, selectionFormatWrites } from './NumberFormatControls';

const sheet = sheetDocument({ id: 'format-sheet', name: 'Formats', rowCount: 2, columnCount: 2 });
const selection = {
  mode: 'cells' as const,
  anchor: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } },
  extent: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! } },
};

describe('number format selection controls', () => {
  it('writes every durable cell in a rectangle, including blank cells', () => {
    expect(selectionFormatWrites(sheet, selection, { kind: 'number', precision: 2 })).toEqual([
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! }), numberFormat: { kind: 'number', precision: 2 } },
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! }), numberFormat: { kind: 'number', precision: 2 } },
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[0]! }), numberFormat: { kind: 'number', precision: 2 } },
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! }), numberFormat: { kind: 'number', precision: 2 } },
    ]);
    expect(selectionFormatWrites(sheet, { ...selection, mode: 'rows' }, null)).toEqual([
      { scope: 'row', targetId: sheet.content.rows[0], numberFormat: null },
      { scope: 'row', targetId: sheet.content.rows[1], numberFormat: null },
    ]);
    expect(selectionFormatWrites(sheet, { ...selection, mode: 'columns' }, null)).toEqual([
      { scope: 'column', targetId: sheet.content.columns[0], numberFormat: null },
      { scope: 'column', targetId: sheet.content.columns[1], numberFormat: null },
    ]);
  });

  it('reports homogeneous effective formats and mixed local selections', () => {
    const first = cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! });
    const formatted = { ...sheet, presentation: {
      ...sheet.presentation,
      formatOverrides: { rows: {}, columns: { [sheet.content.columns[0]!]: { numberFormat: { kind: 'percent' as const, precision: 1 } } }, cells: { [first]: { numberFormat: { kind: 'general' as const } } } },
    } };
    expect(selectionFormatControlState(formatted, { ...selection, extent: selection.anchor })).toEqual({ format: { kind: 'general' }, hasLocalOverrides: true });
    expect(selectionFormatControlState(formatted, selection).format).toBeNull();
    expect(selectionFormatControlState(undefined, selection)).toEqual({ format: null, hasLocalOverrides: false });
  });
});
