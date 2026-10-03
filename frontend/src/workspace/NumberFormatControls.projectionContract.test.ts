import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { CellAppearance, SheetFormatOverrides } from '@workbook/core/model';
import { sheetDocument } from '@test-support/workbookFactories';
import { formattingSelectionControlState } from '@test-support/formattingSelectionControlState';

const defaults: Required<CellAppearance> = {
  numberFormat: { kind: 'general' }, fontWeight: 'normal', horizontalAlignment: 'general', textColor: 'automatic', fillColor: 'none',
};
const different: Required<CellAppearance> = {
  numberFormat: { kind: 'percent', precision: 3 }, fontWeight: 'bold', horizontalAlignment: 'right', textColor: '#abcdef', fillColor: '#123456',
};

describe.each(['cells', 'rows', 'columns'] as const)('%s projection contract evidence', (mode) => {
  const sheet = sheetDocument({ id: 'contract', name: 'Contract', rowCount: 2, columnCount: 2 });
  const endpoint = (index: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[index]!, columnId: sheet.content.columns[index]! } });
  const selection = { mode, anchor: endpoint(1), extent: endpoint(0) };
  const keys = sheet.content.rows.flatMap((rowId) => sheet.content.columns.map((columnId) => cellIdentityKey({ rowId, columnId })));
  const group = mode === 'cells' ? 'cells' : mode;
  const targetIds = mode === 'cells' ? keys : sheet.content[mode];
  const styled = (overrides: SheetFormatOverrides) => ({ ...sheet, presentation: { ...sheet.presentation, formatOverrides: overrides } });

  it('keeps mixed local provenance with uniform effective defaults, including the stricter number rule', () => {
    const overrides: SheetFormatOverrides = { rows: {}, columns: {}, cells: {}, [group]: { [targetIds[0]!]: defaults } };
    const source = styled(overrides);
    const { appearance, format } = formattingSelectionControlState(source, selection);
    for (const property of ['fontWeight', 'horizontalAlignment', 'textColor', 'fillColor'] as const) {
      expect(appearance[property]).toEqual({ value: defaults[property], localValue: null, localOverrideState: 'mixed', hasLocalOverrides: true });
    }
    expect(format).toEqual({ format: null, hasLocalOverrides: true });
  });

  it('removes an apparent mixed baseline only when cells cover every effective position', () => {
    const overrides: SheetFormatOverrides = {
      rows: { [sheet.content.rows[0]!]: different }, columns: {},
      cells: Object.fromEntries(keys.map((key) => [key, defaults])),
    };
    const completeSource = styled(overrides);
    const incompleteSource = styled({ ...overrides, cells: Object.fromEntries(keys.slice(1).map((key) => [key, defaults])) });
    const complete = formattingSelectionControlState(completeSource, selection);
    const incomplete = formattingSelectionControlState(incompleteSource, selection);
    for (const property of ['fontWeight', 'horizontalAlignment', 'textColor', 'fillColor'] as const) {
      expect(complete.appearance[property].value).toEqual(defaults[property]);
      expect(incomplete.appearance[property].value).toBeNull();
    }
    expect(complete.format.format).toEqual(mode === 'rows' ? null : defaults.numberFormat);
    expect(incomplete.format.format).toBeNull();
  });

  it('finds a late exception for every property even on blank cells', () => {
    const source = styled({ rows: {}, columns: {}, cells: { [keys[keys.length - 1]!]: different } });
    const { appearance, format } = formattingSelectionControlState(source, selection);
    for (const property of ['fontWeight', 'horizontalAlignment', 'textColor', 'fillColor'] as const) expect(appearance[property].value).toBeNull();
    expect(format.format).toBeNull();
  });
});
