import { evaluateFormulaCells } from './formulaEvaluator';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import type { Workbook } from '@workbook/core/model';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { cellKey } from '@workbook/core/address';

/** Evaluates a bound sheet before its calculated cells become ordinary stored values. */
export function materializedDataModelCells(workbook: Workbook, sheetId: string): Record<string, string> {
  const sheet = workbook.documents[sheetId];
  const model = sheet?.dataModelId && workbook.dataModels?.[sheet.dataModelId];
  if (!sheet || !model) return {};
  const evaluated = evaluateFormulaCells(calculationProjection(workbook))[sheetId] ?? {};
  return Object.fromEntries(model.properties.flatMap((property, columnIndex) => {
    if (property.kind !== 'calculated') return [];
    const columnId = sheet.content.columns[columnIndex];
    return columnId === undefined ? [] : sheet.content.rows.map((rowId, rowIndex) => [
      cellIdentityKey({ rowId, columnId }),
      ordinaryCellContent(evaluated[cellKey({ rowIndex, columnIndex })]?.display ?? ''),
    ]);
  }));
}

/** A leading equals sign would otherwise become a new formula after unbinding. */
function ordinaryCellContent(value: string): string {
  return value.startsWith('=') ? `'${value}` : value;
}
