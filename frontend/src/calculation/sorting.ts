import type { FormulaScalarValue } from './formulaValue';
import type { ColumnId, RowId, SheetDocument } from '@workbook/core/model';

const rank = { number: 0, text: 1, boolean: 2, blank: 3, error: 4 } as const;
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function compareSortValues(a: FormulaScalarValue, b: FormulaScalarValue): number {
  const difference = rank[a.kind] - rank[b.kind];
  if (difference) return difference;
  if (a.kind === 'number' && b.kind === 'number') return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  if (a.kind === 'text' && b.kind === 'text') return lexical(a.value, b.value);
  if (a.kind === 'boolean' && b.kind === 'boolean') return Number(a.value) - Number(b.value);
  if (a.kind === 'error' && b.kind === 'error') return lexical(a.error, b.error);
  return 0;
}

export function sortedRowPermutation(sheet: SheetDocument, valueAt: (rowId: RowId, columnId: ColumnId) => FormulaScalarValue): RowId[] {
  const criteria = sheet.sorting ?? [];
  return sheet.content.rows.map((rowId, index) => ({ rowId, index, keys: criteria.map(({ columnId }) => valueAt(rowId, columnId)) }))
    .sort((a, b) => {
      for (let index = 0; index < criteria.length; index += 1) {
        const comparison = compareSortValues(a.keys[index]!, b.keys[index]!);
        if (comparison) return criteria[index]!.direction === 'ascending' ? comparison : -comparison;
      }
      return a.index - b.index;
    }).map(({ rowId }) => rowId);
}
