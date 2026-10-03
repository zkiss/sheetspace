import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { CellAppearance } from '@workbook/core/model';
import { validateFormattingSelection, type FormattingSelection, type ValidFormattingSelection } from '@workbook/read/formattingSelection';
import { formattingProperties, type FormattingProperty } from '@workbook/read/formattingSummary';
import { sheetDocument } from './workbookFactories';

export const formattingValues: { [P in FormattingProperty]: readonly NonNullable<CellAppearance[P]>[] } = {
  numberFormat: [{ kind: 'number', precision: 2 }, { kind: 'percent', precision: 1 }, { precision: 2, kind: 'number' }],
  fontWeight: ['bold', 'normal'], horizontalAlignment: ['left', 'right'],
  textColor: ['#AaBbCc', '#aabbcc'], fillColor: ['#445566', '#778899'],
};
export function appearanceVariant(index = 0): CellAppearance {
  return Object.fromEntries(formattingProperties.map((p) => [p, formattingValues[p][index % formattingValues[p].length]])) as CellAppearance;
}

export function formattingFixture(mode: FormattingSelection['mode'], rowCount = 9, columnCount = 11, r = rowCount, c = columnCount) {
  const sheet = sheetDocument({ id: 'summary', name: 'Summary', rowCount, columnCount });
  const endpoint = (row: number, column: number) => ({ sheetId: sheet.id, cell: { rowId: sheet.content.rows[row]!, columnId: sheet.content.columns[column]! } });
  const input = { mode, anchor: endpoint(r - 1, c - 1), extent: endpoint(0, 0) };
  const validate = () => {
    const result = validateFormattingSelection(sheet, input);
    if (!result.valid) throw new Error('fixture selection must validate');
    return result;
  };
  return { sheet, input, selection: validate(), validate };
}

/** Bounded correctness fixtures only; scaling tests must not materialize E positions. */
export function coverageKeys(selection: ValidFormattingSelection) {
  const keys: string[] = [];
  for (let r = selection.effectiveRowStart; r <= selection.effectiveRowEnd; r += 1) {
    for (let c = selection.effectiveColumnStart; c <= selection.effectiveColumnEnd; c += 1) {
      keys.push(cellIdentityKey({ rowId: selection.rows[r]!, columnId: selection.columns[c]! }));
    }
  }
  return keys;
}
