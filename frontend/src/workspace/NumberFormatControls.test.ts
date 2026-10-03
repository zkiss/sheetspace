import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument } from '@test-support/workbookFactories';
import { formattingSelectionControlState } from '@test-support/formattingSelectionControlState';
import { selectionAppearanceWrites, selectionFormattingWrites } from '@workbook/read/formattingWrites';

const sheet = sheetDocument({ id: 'format-sheet', name: 'Formats', rowCount: 2, columnCount: 2 });
const selection = {
  mode: 'cells' as const,
  anchor: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! } },
  extent: { sheetId: sheet.id, cell: { rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! } },
};

describe('number format selection controls', () => {
  it('writes every durable cell in a rectangle, including blank cells', () => {
    expect(selectionFormattingWrites(sheet, selection, 'numberFormat', { kind: 'number', precision: 2 })).toEqual([
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! }), properties: { numberFormat: { kind: 'number', precision: 2 } } },
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! }), properties: { numberFormat: { kind: 'number', precision: 2 } } },
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[0]! }), properties: { numberFormat: { kind: 'number', precision: 2 } } },
      { scope: 'cell', targetId: cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! }), properties: { numberFormat: { kind: 'number', precision: 2 } } },
    ]);
    expect(selectionFormattingWrites(sheet, { ...selection, mode: 'rows' }, 'numberFormat', null)).toEqual([
      { scope: 'row', targetId: sheet.content.rows[0], properties: { numberFormat: null } },
      { scope: 'row', targetId: sheet.content.rows[1], properties: { numberFormat: null } },
    ]);
    expect(selectionFormattingWrites(sheet, { ...selection, mode: 'columns' }, 'numberFormat', null)).toEqual([
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
    expect(formattingSelectionControlState(formatted, { ...selection, extent: selection.anchor }).format).toEqual({ format: { kind: 'general' }, hasLocalOverrides: true });
    expect(formattingSelectionControlState(formatted, selection).format.format).toBeNull();
    expect(formattingSelectionControlState(undefined, selection).format).toEqual({ format: null, hasLocalOverrides: false });
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

    expect(formattingSelectionControlState(formatted, columnSelection).format).toEqual({ format: null, hasLocalOverrides: true });
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
    expect(formattingSelectionControlState(styled, { ...selection, extent: selection.anchor }).appearance).toMatchObject({
      fontWeight: { value: 'bold', localOverrideState: 'inherited', hasLocalOverrides: false },
      fillColor: { value: 'none', localOverrideState: 'explicit', hasLocalOverrides: true },
      horizontalAlignment: { value: 'general', localOverrideState: 'inherited', hasLocalOverrides: false },
    });
  });

  it('rejects incomplete appearance patches and invalid selections', () => {
    const invalidSelection = {
      ...selection,
      anchor: { sheetId: sheet.id, cell: { rowId: 'missing-row', columnId: sheet.content.columns[0]! } },
    };

    expect(selectionAppearanceWrites(sheet, selection, {})).toEqual([]);
    expect(selectionAppearanceWrites(sheet, selection, { fontWeight: 'bold', fillColor: '#abcdef' })).toEqual([]);
    expect(selectionAppearanceWrites(sheet, invalidSelection, { fontWeight: 'bold' })).toEqual([]);
    expect(formattingSelectionControlState(undefined, selection).appearance.fontWeight).toEqual({
      value: null, localValue: null, localOverrideState: 'inherited', hasLocalOverrides: false,
    });
    expect(formattingSelectionControlState(sheet, invalidSelection).appearance.fillColor).toEqual({
      value: null, localValue: null, localOverrideState: 'inherited', hasLocalOverrides: false,
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
    const effectiveAppearance = formattingSelectionControlState(mixedEffective, { ...selection, mode }).appearance;
    expect(effectiveAppearance.fontWeight)
      .toMatchObject({ value: null, localOverrideState: 'mixed' });
    expect(effectiveAppearance.textColor)
      .toMatchObject({ value: null, localOverrideState: 'mixed' });

    const mixedLocal = {
      ...sheet, presentation: { ...sheet.presentation, formatOverrides: localOverrides },
    };
    expect(formattingSelectionControlState(mixedLocal, { ...selection, mode }).appearance.fontWeight)
      .toMatchObject({ value: 'normal', localOverrideState: 'mixed' });
  });
});
