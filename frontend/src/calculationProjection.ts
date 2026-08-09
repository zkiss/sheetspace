import type { CellKey } from './cellAddress';
import {
  sheetsInOrder,
  sheetBounds,
  tabularCellsByA1,
  type Workbook,
} from './workbook';

export type CalculationSheet = {
  readonly id: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly cells: Readonly<Record<CellKey, string>>;
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
      ...sheetBounds(sheet),
      cells: tabularCellsByA1(sheet.content),
    })),
  };
}
