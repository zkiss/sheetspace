import { FormulaCalculation } from '@calculation/formulaCalculation';
import { classifyCellValue, type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { sortedRowPermutation } from '@calculation/sorting';
import { cellKey } from '@workbook/core/address';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { applyAxisPermutation } from '@workbook/mutations/reorderAxis';
import { calculationProjection, type CalculationImpact } from '@workbook/read/calculationProjection';
import { sheetsInOrder } from '@workbook/read/queries';

export type SortingSettlement = {
  workbook: Workbook;
  calculation: FormulaCalculation;
  snapshot: FormulaEvaluationSnapshot;
  orders: { sheetId: string; before: readonly string[]; after: readonly string[] }[];
};

export function settleSorting(candidate: Workbook, calculation: FormulaCalculation, impact: CalculationImpact): SortingSettlement {
  const fork = calculation.fork();
  const snapshot = fork.updateStored(calculationProjection(candidate), candidate, impact);
  const permutations = sheetsInOrder(candidate).filter((sheet) => sheet.sorting?.length).map((sheet) => ({
    sheetId: sheet.id,
    rows: sortedRowPermutation(sheet, (rowId, columnId) => {
      const rowIndex = sheet.content.rows.indexOf(rowId);
      const columnIndex = sheet.content.columns.indexOf(columnId);
      return snapshot[sheet.id]?.[cellKey({ rowIndex, columnIndex })]
        ?? classifyCellValue(sheet.content.cells[cellIdentityKey({ rowId, columnId })] ?? '');
    }),
  }));
  let workbook = candidate;
  const orders: SortingSettlement['orders'] = [];
  for (const permutation of permutations) {
    const result = applyAxisPermutation(workbook, permutation.sheetId, 'row', permutation.rows);
    if (result.status === 'changed') {
      workbook = result.workbook;
      orders.push({ sheetId: permutation.sheetId, before: result.before, after: result.after });
    }
  }
  const finalSnapshot = orders.length
    ? fork.updateStored(calculationProjection(workbook), workbook, { kind: 'structure' })
    : snapshot;
  return { workbook, calculation: fork, snapshot: finalSnapshot, orders };
}
