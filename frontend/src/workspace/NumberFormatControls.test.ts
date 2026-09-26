import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument } from '@test-support/workbookFactories';
import { selectionAppearanceControlState, selectionAppearanceWrites, selectionFormatControlState, selectionFormatWrites } from './NumberFormatControls';

const sheet = sheetDocument({ id: 'format-sheet', name: 'Formats', rowCount: 2, columnCount: 2 });
const selection = {
  mode: 'cells' as const,
  anchor: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } },
  extent: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! } },
};

describe('number format selection controls', () => {
  it('writes every durable cell in a rectangle, including blank cells', () => {
    expect(selectionFormatWrites(sheet, selection, { kind: 'number', precision: 2 })).toEqual([
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! }), properties: { numberFormat: { kind: 'number', precision: 2 } } },
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! }), properties: { numberFormat: { kind: 'number', precision: 2 } } },
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[0]! }), properties: { numberFormat: { kind: 'number', precision: 2 } } },
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! }), properties: { numberFormat: { kind: 'number', precision: 2 } } },
    ]);
    expect(selectionFormatWrites(sheet, { ...selection, mode: 'rows' }, null)).toEqual([
      { scope: 'row', targetId: sheet.content.rows[0], properties: { numberFormat: null } },
      { scope: 'row', targetId: sheet.content.rows[1], properties: { numberFormat: null } },
    ]);
    expect(selectionFormatWrites(sheet, { ...selection, mode: 'columns' }, null)).toEqual([
      { scope: 'column', targetId: sheet.content.columns[0], properties: { numberFormat: null } },
      { scope: 'column', targetId: sheet.content.columns[1], properties: { numberFormat: null } },
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

  it('reports mixed effective formats for a whole-axis selection with a cell exception', () => {
    const columnId = sheet.content.columns[0]!;
    const exceptionalCell = cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId });
    const formatted = {
      ...sheet,
      presentation: {
        ...sheet.presentation,
        formatOverrides: {
          rows: {},
          columns: { [columnId]: { numberFormat: { kind: 'number' as const, precision: 2 } } },
          cells: { [exceptionalCell]: { numberFormat: { kind: 'percent' as const, precision: 0 } } },
        },
      },
    };
    const columnSelection = { ...selection, mode: 'columns' as const, extent: selection.anchor };

    expect(selectionFormatControlState(formatted, columnSelection)).toEqual({ format: null, hasLocalOverrides: true });
  });

  it('writes individual appearance properties and reports their independent effective state', () => {
    const targetId = cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! });
    expect(selectionAppearanceWrites(sheet, { ...selection, extent: selection.anchor }, { fillColor: '#abcdef' })).toEqual([
      { scope: 'cell', targetId, properties: { fillColor: '#abcdef' } },
    ]);
    const styled = {
      ...sheet,
      presentation: {
        ...sheet.presentation,
        formatOverrides: { rows: { [sheet.content.rows[0]!]: { fontWeight: 'bold' as const } }, columns: {}, cells: { [targetId]: { fillColor: 'none' as const } } },
      },
    };
    expect(selectionAppearanceControlState(styled, { ...selection, extent: selection.anchor })).toMatchObject({
      fontWeight: { value: 'bold', localOverrideState: 'inherited', hasLocalOverrides: false },
      fillColor: { value: 'none', localOverrideState: 'explicit', hasLocalOverrides: true },
      horizontalAlignment: { value: 'general', localOverrideState: 'inherited', hasLocalOverrides: false },
    });
  });

  it.each(['cells', 'rows', 'columns'] as const)('distinguishes mixed effective values from mixed local provenance for %s selections', (mode) => {
    const first = cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! });
    const second = cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! });
    const localOverrides = mode === 'cells'
      ? { rows: { [sheet.content.rows[0]!]: { fontWeight: 'normal' as const } }, columns: {}, cells: { [first]: { fontWeight: 'normal' as const } } }
      : mode === 'rows'
        ? { rows: { [sheet.content.rows[0]!]: { fontWeight: 'normal' as const } }, columns: {}, cells: {} }
        : { rows: {}, columns: { [sheet.content.columns[0]!]: { fontWeight: 'normal' as const } }, cells: {} };
    const mixedColourOverrides = mode === 'cells'
      ? { rows: {}, columns: {}, cells: { [first]: { fontWeight: 'bold' as const, textColor: '#ff0000' as const }, [second]: { textColor: '#00ff00' as const } } }
      : mode === 'rows'
        ? { rows: { [sheet.content.rows[0]!]: { fontWeight: 'bold' as const, textColor: '#ff0000' as const }, [sheet.content.rows[1]!]: { textColor: '#00ff00' as const } }, columns: {}, cells: {} }
        : { rows: {}, columns: { [sheet.content.columns[0]!]: { fontWeight: 'bold' as const, textColor: '#ff0000' as const }, [sheet.content.columns[1]!]: { textColor: '#00ff00' as const } }, cells: {} };
    const mixedEffective = {
      ...sheet, presentation: { ...sheet.presentation, formatOverrides: mixedColourOverrides },
    };
    expect(selectionAppearanceControlState(mixedEffective, { ...selection, mode }).fontWeight)
      .toMatchObject({ value: null, localOverrideState: 'mixed' });
    expect(selectionAppearanceControlState(mixedEffective, { ...selection, mode }).textColor)
      .toMatchObject({ value: null, localOverrideState: 'mixed' });

    const mixedLocal = {
      ...sheet, presentation: { ...sheet.presentation, formatOverrides: localOverrides },
    };
    expect(selectionAppearanceControlState(mixedLocal, { ...selection, mode }).fontWeight)
      .toMatchObject({ value: 'normal', localOverrideState: 'mixed' });
  });
});
