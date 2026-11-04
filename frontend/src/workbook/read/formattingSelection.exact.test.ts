import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { emptySheetFormatOverrides } from '@workbook/core/numberFormat';
import { sheetDocument } from '@test-support/workbookFactories';
import { validateFormattingSelection } from './formattingSelection';
import { selectionFormattingWrites } from './formattingWrites';
import { summarizeFormattingDense, summarizeFormattingSparse } from './formattingSummary';

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
});
