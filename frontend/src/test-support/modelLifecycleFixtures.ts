import type { DataModel, ModelColumn, SheetDocument, Workbook } from '@workbook/core/model';
import type { ModelMutationResult } from '@workbook/mutations/dataModel';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { tabularCellsByA1 } from '@workbook/read/queries';
import { bindSheetToModel } from '@application/core/modelLifecycle';
import { workbookWithSheets } from './workbookFactories';

export const manualProperty = (id: string, name = id): ModelColumn => ({ id, name, kind: 'manual', type: 'float' });
export const calculatedProperty = (id: string, formula: string, name = id): ModelColumn => ({ id, name, kind: 'calculated', type: 'float', formula });
export const declaration = (columns: readonly ModelColumn[]): DataModel => ({ id: 'model', name: 'Model', columns });
export function modelWorkbook(model: DataModel, sheets: SheetDocument[]): Workbook {
  return { ...workbookWithSheets(sheets), dataModels: { [model.id]: model } };
}
export function successfulModelMutation(result: ModelMutationResult): Workbook {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
export function freshColumns(): () => string {
  let sequence = 0;
  return () => `fresh-${++sequence}`;
}
export function bindModelSheets(workbook: Workbook, ids: string[], createId = freshColumns()): Workbook {
  return ids.reduce((current, id) => successfulModelMutation(bindSheetToModel(current, id, 'model', createId)), workbook);
}
export const storedModelCells = (workbook: Workbook, id = 'sheet') => tabularCellsByA1(workbook.documents[id]!.content);
export const calculatedModelCells = (workbook: Workbook) => new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' });
