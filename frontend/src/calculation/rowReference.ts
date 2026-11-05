import type { CalculationSheet } from '@workbook/read/calculationProjection';
import { calculationCellKey } from '@workbook/read/calculationProjection';
import type { FormulaReference } from '@workbook/formula/syntax';

type RowReference = Extract<FormulaReference, { kind: 'row-reference' }>;

export function resolveRowReference(sheet: CalculationSheet, reference: RowReference): { keys: string[]; rowCount: number; columnCount: number } | undefined {
  const resolve = (endpoint: RowReference['endpoints'][number], openRow: number) => {
    if (!('columnId' in endpoint.value)) return undefined;
    const { columnId } = endpoint.value;
    const propertyId = 'propertyId' in endpoint.value ? endpoint.value.propertyId : undefined;
    if (propertyId && !((propertyId === columnId && sheet.ordinaryNamedColumnIds?.has(columnId)) || (sheet.modelColumnBindings?.[propertyId] === columnId && sheet.modelPropertyIds?.has(propertyId)))) return undefined;
    const column = sheet.columns.indexOf(columnId);
    const row = endpoint.kind === 'positional-canonical' ? endpoint.value.rowIndex : endpoint.kind === 'open-canonical' ? openRow : 'rowId' in endpoint.value ? sheet.rows.indexOf(endpoint.value.rowId) : -1;
    return column >= 0 && row >= 0 && row < sheet.rows.length ? { row, column } : undefined;
  };
  const start = resolve(reference.endpoints[0], 0);
  if (!start) return undefined;
  const end = reference.endpoints[1] ? resolve(reference.endpoints[1], sheet.rows.length - 1) : start;
  if (!end) return undefined;
  const keys: string[] = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row++) {
    for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column++) {
      keys.push(calculationCellKey(sheet, { rowId: sheet.rows[row]!, columnId: sheet.columns[column]! })!);
    }
  }
  return { keys, rowCount: Math.abs(start.row - end.row) + 1, columnCount: Math.abs(start.column - end.column) + 1 };
}
