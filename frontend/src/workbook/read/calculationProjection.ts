import { cellIdentityKey } from '../core/cellIdentity';
import { type Workbook } from '../core/model';
import type { CellKey } from '../core/address';
import { sheetsInOrder } from './queries';

export type CalculationSheet = {
  readonly id: string;
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  /** Raw values keyed by durable row/column identity, never by A1 position. */
  readonly cells: Readonly<Record<string, string>>;
};

export type CalculationProjection = {
  readonly sheets: readonly CalculationSheet[];
};

export type CalculationCellChange = {
  readonly sheetId: string;
  readonly key: CellKey;
};

export type CalculationImpact =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'cells';
      readonly cells: readonly CalculationCellChange[];
    }
  | { readonly kind: 'structure' };

export function calculationProjection(
  source: Workbook,
): CalculationProjection {
  return {
    sheets: sheetsInOrder(source).map((sheet) => ({
      id: sheet.id,
      rows: sheet.content.rows,
      columns: sheet.content.columns,
      cells: sheet.content.cells,
    })),
  };
}

export function calculationCellKey(
  sheet: CalculationSheet,
  coordinate: { readonly rowId: string; readonly columnId: string },
): string | undefined {
  return sheet.rows.includes(coordinate.rowId) && sheet.columns.includes(coordinate.columnId)
    ? cellIdentityKey(coordinate)
    : undefined;
}
