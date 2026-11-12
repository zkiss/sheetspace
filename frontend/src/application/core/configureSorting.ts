import { FormulaCalculation } from '@calculation/formulaCalculation';
import type { SortCriterion, Workbook } from '@workbook/core/model';
import { setSheetSorting } from '@workbook/core/sorting';
import { settleSorting, type SortingSettlement } from './settleSorting';

export type ConfigureSortingResult =
  | { status: 'rejected' | 'unchanged'; workbook: Workbook }
  | ({ status: 'changed' } & SortingSettlement);

export function configureSorting(
  workbook: Workbook,
  sheetId: string,
  criteria: readonly SortCriterion[],
  calculation: FormulaCalculation,
): ConfigureSortingResult {
  const configured = setSheetSorting(workbook, sheetId, criteria);
  if (configured.status !== 'changed') return { status: configured.status, workbook };
  return { status: 'changed', ...settleSorting(configured.workbook, calculation, { kind: 'structure' }) };
}
