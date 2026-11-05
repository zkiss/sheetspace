import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { emptySheetFormatOverrides } from '@workbook/core/numberFormat';
import { sheetDocument } from '@test-support/workbookFactories';
import { validateFormattingSelection } from './formattingSelection';
import { selectionFormattingWrites } from './formattingWrites';
import { summarizeFormattingDense, summarizeFormattingSparse } from './formattingSummary';
import type { SparseFormattingMetrics } from './formattingSummarySparse';

describe.each(['rows', 'columns'] as const)('exact %s formatting', (mode) => {
  it('excludes gaps from validation, writes, effective formatting and local summaries', () => {
    const sheet = sheetDocument({ id: 'exact', name: 'Exact', rowCount: 3, columnCount: 3 });
    const axis = sheet.content[mode];
    const target = (index: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[index]!, columnId: sheet.content.columns[index]! } });
    const selection = { mode, anchor: target(0), extent: target(2), members: [axis[0]!, axis[2]!] };
    const validated = validateFormattingSelection(sheet, selection);
    expect(validated).toMatchObject({ valid: true, effectiveSize: 6, writeCount: 2 });
    if (!validated.valid) throw new Error('expected valid selection');
    expect(selectionFormattingWrites(sheet, selection, 'fontWeight', 'bold').map((write) => write.targetId)).toEqual([axis[0], axis[2]]);
    const overrides = emptySheetFormatOverrides();
    overrides[mode][axis[1]!] = { fontWeight: 'bold' };
    overrides.cells[cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! })] = { fontWeight: 'bold' };
    const dense = summarizeFormattingDense(validated, overrides);
    expect(summarizeFormattingSparse(validated, overrides)).toEqual(dense);
    expect(dense.fontWeight).toMatchObject({ effectiveValue: 'normal', localOverrideState: 'inherited', hasLocalOverrides: false });
    overrides[mode][axis[0]!] = { fontWeight: 'bold' };
    expect(summarizeFormattingSparse(validated, overrides)).toEqual(summarizeFormattingDense(validated, overrides));
    expect(summarizeFormattingDense(validated, overrides).fontWeight).toMatchObject({ effectiveValue: null, localOverrideState: 'mixed' });
    expect(validateFormattingSelection(sheet, { ...selection, anchor: target(1), members: [...axis] })).toMatchObject({ valid: true, [mode === 'rows' ? 'rowStart' : 'columnStart']: 0 });
    expect(validateFormattingSelection(sheet, { ...selection, members: [axis[0]!, 'stale', axis[2]!] })).toEqual({ valid: false });
    expect(validateFormattingSelection(sheet, { ...selection, members: [axis[0]!, axis[0]!, axis[2]!] })).toEqual({ valid: false });
  });

  it('counts selected cell corrections and opposite-axis inheritance without including gap overrides', () => {
    const sheet = sheetDocument({ id: 'scattered', name: 'Scattered', rowCount: 3, columnCount: 3 });
    const axis = sheet.content[mode];
    const opposite = sheet.content[mode === 'rows' ? 'columns' : 'rows'];
    const target = (index: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[index]!, columnId: sheet.content.columns[index]! } });
    const selection = validateFormattingSelection(sheet, { mode, anchor: target(0), extent: target(2), members: [axis[0]!, axis[2]!] });
    if (!selection.valid) throw new Error('expected valid selection');

    const overrides = emptySheetFormatOverrides();
    const oppositeOverrides = mode === 'rows' ? overrides.columns : overrides.rows;
    for (const id of opposite) oppositeOverrides[id] = { fontWeight: 'bold' };
    overrides[mode][axis[0]!] = { fillColor: '#112233' };
    overrides[mode][axis[1]!] = { fillColor: '#445566' };
    const selectedCell = cellIdentityKey({ rowId: sheet.content.rows[0]!, columnId: sheet.content.columns[0]! });
    const gapCell = cellIdentityKey({ rowId: sheet.content.rows[1]!, columnId: sheet.content.columns[1]! });
    overrides.cells[selectedCell] = { fontWeight: 'normal' };
    overrides.cells[gapCell] = { fontWeight: 'normal' };

    const metrics = {} as SparseFormattingMetrics;
    const dense = summarizeFormattingDense(selection, overrides);
    expect(summarizeFormattingSparse(selection, overrides, metrics)).toEqual(dense);
    expect(dense.fontWeight).toEqual({ effectiveValue: null, localValue: null, localOverrideState: 'inherited', hasLocalOverrides: false });
    expect(dense.fillColor).toEqual({ effectiveValue: null, localValue: null, localOverrideState: 'mixed', hasLocalOverrides: true });
    expect(metrics).toMatchObject({ cellRecordVisits: 2, relevantRecords: 1, corrections: 1, membershipEntries: 5, effectiveTotals: [6, 6, 6, 6, 6] });
    expect(selectionFormattingWrites(sheet, { mode, anchor: target(0), extent: target(2), members: [axis[0]!, axis[2]!] }, 'fillColor', '#abcdef').map((write) => write.targetId)).toEqual([axis[0], axis[2]]);

    overrides.cells[selectedCell] = { fontWeight: 'bold' };
    overrides[mode][axis[2]!] = { fillColor: '#112233' };
    const masked = summarizeFormattingDense(selection, overrides);
    expect(summarizeFormattingSparse(selection, overrides, metrics)).toEqual(masked);
    expect(masked.fontWeight).toEqual({ effectiveValue: 'bold', localValue: null, localOverrideState: 'inherited', hasLocalOverrides: false });
    expect(masked.fillColor).toEqual({ effectiveValue: '#112233', localValue: '#112233', localOverrideState: 'explicit', hasLocalOverrides: true });
    expect(metrics).toMatchObject({ relevantRecords: 1, corrections: 1, effectiveTotals: [6, 6, 6, 6, 6] });
    expect(overrides.cells[gapCell]).toEqual({ fontWeight: 'normal' });
    expect(overrides[mode][axis[1]!]).toEqual({ fillColor: '#445566' });
  });
});
