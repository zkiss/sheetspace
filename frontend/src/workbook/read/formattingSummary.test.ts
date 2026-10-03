import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { APPLICATION_DEFAULT_FILL_COLOR, APPLICATION_DEFAULT_FONT_WEIGHT, APPLICATION_DEFAULT_HORIZONTAL_ALIGNMENT, APPLICATION_DEFAULT_NUMBER_FORMAT, APPLICATION_DEFAULT_TEXT_COLOR } from '@workbook/core/numberFormat';
import type { CellAppearance, SheetFormatOverrides } from '@workbook/core/model';
import { sheetDocument } from '@test-support/workbookFactories';
import { validateFormattingSelection, type FormattingSelection } from './formattingSelection';
import { formattingProperties, summarizeFormatting, type FormattingProperty } from './formattingSummary';

const propertyValues: { [Property in FormattingProperty]: readonly [NonNullable<CellAppearance[Property]>, NonNullable<CellAppearance[Property]>] } = {
  numberFormat: [{ kind: 'number', precision: 2 }, { kind: 'percent', precision: 1 }],
  fontWeight: ['bold', 'normal'], horizontalAlignment: ['left', 'right'], textColor: ['#AaBbCc', '#112233'], fillColor: ['#445566', '#778899'],
};
const applicationDefaults = {
  numberFormat: APPLICATION_DEFAULT_NUMBER_FORMAT, fontWeight: APPLICATION_DEFAULT_FONT_WEIGHT,
  horizontalAlignment: APPLICATION_DEFAULT_HORIZONTAL_ALIGNMENT, textColor: APPLICATION_DEFAULT_TEXT_COLOR, fillColor: APPLICATION_DEFAULT_FILL_COLOR,
};

function fixture(mode: FormattingSelection['mode'], extent = { row: 1, column: 1 }) {
  const sheet = sheetDocument({ id: 'summary', name: 'Summary', rowCount: 3, columnCount: 3 });
  const endpoint = (row: number, column: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! } });
  const selection = validateFormattingSelection(sheet, { mode, anchor: endpoint(0, 0), extent: endpoint(extent.row, extent.column) });
  if (!selection.valid) throw new Error('fixture selection must validate');
  return { sheet, selection };
}

function overrides(): SheetFormatOverrides { return { rows: {}, columns: {}, cells: {} }; }
function cellKey(sheet: ReturnType<typeof sheetDocument>, row: number, column: number) {
  return cellIdentityKey({ rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! });
}
function record<Property extends FormattingProperty>(property: Property, value: NonNullable<CellAppearance[Property]>): CellAppearance {
  return { [property]: value } as CellAppearance;
}

describe('summarizeFormatting semantics', () => {
  it.each(formattingProperties)('resolves inherited non-default precedence for %s', (property) => {
    const { sheet, selection } = fixture('cells');
    const source = overrides(); const [columnValue, rowValue] = propertyValues[property];
    source.columns[sheet.content.columns[0]!] = record(property, columnValue);
    source.rows[sheet.content.rows[0]!] = record(property, rowValue);
    source.cells[cellKey(sheet, 0, 0)] = record(property, columnValue);
    const summary = summarizeFormatting(selection, source)[property];
    expect(summary).toMatchObject({ effectiveValue: null, localValue: null, localOverrideState: 'mixed', hasLocalOverrides: true });
  });

  it.each(formattingProperties)('keeps an explicit application default as a local mask for %s', (property) => {
    const { sheet, selection } = fixture('cells');
    const source = overrides(); const [nonDefault] = propertyValues[property];
    source.columns[sheet.content.columns[0]!] = record(property, nonDefault);
    source.cells[cellKey(sheet, 0, 0)] = record(property, applicationDefaults[property]);
    const summary = summarizeFormatting(selection, source)[property];
    expect(summary).toMatchObject({ effectiveValue: null, localOverrideState: 'mixed', hasLocalOverrides: true });
    expect(summary.localValue).toBeNull();
  });

  it.each(formattingProperties)('distinguishes partial local provenance from uniform effective values for %s', (property) => {
    const { sheet, selection } = fixture('cells');
    const source = overrides(); const [value] = propertyValues[property];
    source.columns[sheet.content.columns[0]!] = record(property, value);
    source.columns[sheet.content.columns[1]!] = record(property, value);
    source.cells[cellKey(sheet, 0, 0)] = record(property, value);
    const summary = summarizeFormatting(selection, source)[property];
    expect(summary).toMatchObject({ effectiveValue: value, localValue: null, localOverrideState: 'mixed', hasLocalOverrides: true });
  });

  it('resolves disjoint property records independently', () => {
    const { sheet, selection } = fixture('cells', { row: 0, column: 0 }); const source = overrides();
    for (const [index, property] of formattingProperties.entries()) {
      const [value] = propertyValues[property];
      const target = index % 3 === 0 ? source.cells : index % 3 === 1 ? source.rows : source.columns;
      target[index % 3 === 0 ? cellKey(sheet, 0, 0) : index % 3 === 1 ? sheet.content.rows[0]! : sheet.content.columns[0]!] = record(property, value);
      expect(summarizeFormatting(selection, source)[property]).toMatchObject({ effectiveValue: value, localOverrideState: index % 3 === 0 ? 'explicit' : 'inherited', hasLocalOverrides: index % 3 === 0 });
    }
  });

  it.each(['rows', 'columns'] as const)('includes cell exceptions beyond opposite-axis endpoints for %s selections', (mode) => {
    const { sheet, selection } = fixture(mode, { row: 0, column: 0 }); const source = overrides();
    for (const property of formattingProperties) {
      const [value, exception] = propertyValues[property];
      const axis = mode === 'rows' ? source.rows : source.columns;
      axis[mode === 'rows' ? sheet.content.rows[0]! : sheet.content.columns[0]!] = record(property, value);
      source.cells[cellKey(sheet, mode === 'rows' ? 0 : 2, mode === 'rows' ? 2 : 0)] = { ...source.cells[cellKey(sheet, mode === 'rows' ? 0 : 2, mode === 'rows' ? 2 : 0)], ...record(property, exception) };
      expect(summarizeFormatting(selection, source)[property].effectiveValue).toBeNull();
    }
  });

  it.each(['rows', 'columns'] as const)('handles complete and incomplete axis baseline masking for %s selections', (mode) => {
    const { sheet, selection } = fixture(mode, { row: 1, column: 1 }); const source = overrides();
    const local = mode === 'rows' ? source.rows : source.columns;
    const opposite = mode === 'rows' ? source.columns : source.rows;
    for (const [index, property] of formattingProperties.entries()) {
      const [masked, inherited] = propertyValues[property];
      if (mode === 'rows') opposite[sheet.content.columns[0]!] = { ...opposite[sheet.content.columns[0]!], ...record(property, inherited) };
      local[mode === 'rows' ? sheet.content.rows[0]! : sheet.content.columns[0]!] = { ...local[mode === 'rows' ? sheet.content.rows[0]! : sheet.content.columns[0]!], ...record(property, masked) };
      if (index % 2 === 0) local[mode === 'rows' ? sheet.content.rows[1]! : sheet.content.columns[1]!] = { ...local[mode === 'rows' ? sheet.content.rows[1]! : sheet.content.columns[1]!], ...record(property, masked) };
      const summary = summarizeFormatting(selection, source)[property];
      expect(summary.effectiveValue).toBe(index % 2 === 0 ? masked : null);
    }
  });

  it.each(['cells', 'rows', 'columns'] as const)('finds late mixed values for every property in %s selections', (mode) => {
    const { sheet, selection } = fixture(mode); const source = overrides();
    const target = mode === 'cells' ? source.cells : mode === 'rows' ? source.rows : source.columns;
    const id = mode === 'cells' ? cellKey(sheet, 1, 1) : mode === 'rows' ? sheet.content.rows[1]! : sheet.content.columns[1]!;
    for (const property of formattingProperties) target[id] = { ...target[id], ...record(property, propertyValues[property][0]) };
    const summary = summarizeFormatting(selection, source);
    for (const property of formattingProperties) expect(summary[property].effectiveValue).toBeNull();
  });

  it('ignores inherited prototype records when a selected axis ID is toString', () => {
    const { sheet } = fixture('rows', { row: 0, column: 0 }); sheet.content.rows[0] = 'toString';
    const selection = validateFormattingSelection(sheet, { mode: 'rows', anchor: { sheetId: sheet.id, cell: { rowId: 'toString', columnId: sheet.content.columns[0]! } }, extent: { sheetId: sheet.id, cell: { rowId: 'toString', columnId: sheet.content.columns[0]! } } });
    if (!selection.valid) throw new Error('selection must validate');
    const source = { rows: Object.create({ toString: { fontWeight: 'bold' } }), columns: {}, cells: {} } as SheetFormatOverrides;
    expect(summarizeFormatting(selection, source).fontWeight).toMatchObject({ effectiveValue: 'normal', localOverrideState: 'inherited', hasLocalOverrides: false });
  });

  it('retains number-format insertion-order distinctions', () => {
    const { sheet, selection } = fixture('cells', { row: 0, column: 1 }); const source = overrides();
    source.cells[cellKey(sheet, 0, 0)] = { numberFormat: { kind: 'number', precision: 2 } };
    source.cells[cellKey(sheet, 0, 1)] = { numberFormat: { precision: 2, kind: 'number' } };
    expect(summarizeFormatting(selection, source).numberFormat.effectiveValue).toBeNull();
  });
});
