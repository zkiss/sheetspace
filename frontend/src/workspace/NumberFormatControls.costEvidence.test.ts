import { afterEach, describe, expect, it, vi } from 'vitest';
import * as identity from '@workbook/core/cellIdentity';
import * as policy from '@workbook/core/numberFormat';
import { sheetDocument } from '@test-support/workbookFactories';
import {
  selectionAppearanceControlState, selectionFormatControlState,
} from './NumberFormatControls';
import { selectionAppearanceWrites, selectionFormattingWrites } from '@workbook/read/formattingWrites';

afterEach(() => vi.restoreAllMocks());

describe('extracted geometry and direct write evidence', () => {
  it.each([
    { mode: 'cells', rows: 2, columns: 3, r: 2, c: 2 },
    { mode: 'cells', rows: 100, columns: 100, r: 100, c: 100 },
    { mode: 'rows', rows: 10_000, columns: 100, r: 2, c: 1 },
    { mode: 'columns', rows: 10_000, columns: 100, r: 1, c: 2 },
  ] as const)('$mode: $rows x $columns, endpoint rectangle $r x $c', ({ mode, rows, columns, r, c }) => {
    const sheet = sheetDocument({ id: 'cost', name: 'Cost', rowCount: rows, columnCount: columns });
    const endpoint = (row: number, column: number) => ({
      sheetId: sheet.id, cell: { rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! },
    });
    const selection = { mode, anchor: endpoint(r - 1, c - 1), extent: endpoint(0, 0) };
    const coverage = mode === 'rows' ? r * columns : mode === 'columns' ? rows * c : r * c;
    const targets = mode === 'rows' ? r : mode === 'columns' ? c : r * c;
    const keys = vi.spyOn(identity, 'cellIdentityKey');
    const resolve = vi.spyOn(policy, 'resolveAppearanceProperty');
    const rowBounds = vi.spyOn(sheet.content.rows, 'indexOf');
    const columnBounds = vi.spyOn(sheet.content.columns, 'indexOf');
    const rowSlices = vi.spyOn(sheet.content.rows, 'slice');
    const columnSlices = vi.spyOn(sheet.content.columns, 'slice');

    expect(selectionFormatControlState(sheet, selection)).toEqual({ format: { kind: 'general' }, hasLocalOverrides: false });
    expect(selectionAppearanceControlState(sheet, selection).fillColor.value).toBe('none');
    expect(resolve).toHaveBeenCalledTimes(5 * coverage);
    expect(keys).toHaveBeenCalledTimes(5 * coverage);
    // Each summary validates once and direct range iteration does not slice axes.
    expect(rowBounds).toHaveBeenCalledTimes(4);
    expect(columnBounds).toHaveBeenCalledTimes(4);
    expect(rowSlices).not.toHaveBeenCalled();
    expect(columnSlices).not.toHaveBeenCalled();

    keys.mockClear();
    resolve.mockClear();
    expect(selectionFormattingWrites(sheet, selection, 'numberFormat', null)).toHaveLength(targets);
    expect(selectionAppearanceWrites(sheet, selection, { fillColor: null })).toHaveLength(targets);
    expect(keys).toHaveBeenCalledTimes(mode === 'cells' ? 2 * targets : 0);
    expect(resolve).not.toHaveBeenCalled();
  });
});
