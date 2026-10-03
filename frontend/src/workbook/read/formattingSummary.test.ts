import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetDocument } from '@test-support/workbookFactories';
import { validateFormattingSelection } from './formattingSelection';
import { summarizeFormatting } from './formattingSummary';

describe('summarizeFormatting', () => {
  it.each(['cells', 'rows', 'columns'] as const)('summarizes all five properties for %s selections', (mode) => {
    const sheet = sheetDocument({ id: 'summary', name: 'Summary', rowCount: 2, columnCount: 2 });
    const endpoint = (row: number, column: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! } });
    const selection = validateFormattingSelection(sheet, { mode, anchor: endpoint(0, 0), extent: endpoint(1, 1) });
    if (!selection.valid) throw new Error('fixture selection must validate');
    const target = mode === 'cells'
      ? cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! })
      : sheet.content[mode][0]!;
    const summary = summarizeFormatting(selection, {
      rows: {}, columns: {}, cells: {},
      [mode === 'cells' ? 'cells' : mode]: { [target]: { numberFormat: { kind: 'number', precision: 2 }, fontWeight: 'bold', horizontalAlignment: 'right', textColor: '#AaBbCc', fillColor: '#112233' } },
    });

    for (const property of ['numberFormat', 'fontWeight', 'horizontalAlignment', 'textColor', 'fillColor'] as const) {
      expect(summary[property].localOverrideState).toBe('mixed');
      expect(summary[property].hasLocalOverrides).toBe(true);
    }
    expect(summary.textColor.effectiveValue).toBeNull();
    expect(summary.fillColor.effectiveValue).toBeNull();
  });

  it('uses own records and preserves serialized number-format equality', () => {
    const sheet = sheetDocument({ id: 'safe', name: 'Safe', rowCount: 1, columnCount: 2 });
    const endpoint = (column: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[column]! } });
    const selection = validateFormattingSelection(sheet, { mode: 'cells', anchor: endpoint(0), extent: endpoint(1) });
    if (!selection.valid) throw new Error('fixture selection must validate');
    const first = cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! });
    const second = cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[1]! });
    const cells = Object.create({ toString: { fontWeight: 'bold' } }) as Record<string, object>;
    cells[first] = { numberFormat: { kind: 'number', precision: 2 } };
    cells[second] = { numberFormat: { precision: 2, kind: 'number' } };
    const summary = summarizeFormatting(selection, { rows: {}, columns: {}, cells });

    expect(summary.fontWeight.effectiveValue).toBe('normal');
    expect(summary.numberFormat.effectiveValue).toBeNull();
  });
});
