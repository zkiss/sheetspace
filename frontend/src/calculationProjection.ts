import type { CellKey } from './cellAddress';

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
  source: { readonly sheets: readonly CalculationSheet[] },
): CalculationProjection {
  return {
    sheets: source.sheets.map((sheet) => ({
      id: sheet.id,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      cells: sheet.cells,
    })),
  };
}
