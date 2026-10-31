import type { ModelColumnType, Workbook } from '@workbook/core/model';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { analyzeStoredFormula } from '@workbook/formula/storedFormulaAnalysis';
import { FormulaEvaluator } from './formulaEvaluator';
import { builtInFormulaFunctions } from './formulaBuiltins';
import { classifyCellValue, matchesModelColumnType } from './formulaValue';

export function validRecordValue(workbook: Workbook, sheetId: string, content: string, type: ModelColumnType): boolean {
  try {
    const evaluator = new FormulaEvaluator(calculationProjection(workbook), new Map(), undefined, builtInFormulaFunctions,
      (formula, currentSheetId) => analyzeStoredFormula(formula, workbook, currentSheetId).result);
    const value = content.startsWith('=') ? evaluator.evaluateExpressionContent(content, sheetId) : classifyCellValue(content);
    return value.kind !== 'error' && matchesModelColumnType(value, type);
  } catch {
    return false;
  }
}

/** Values are stored content; the candidate is never inserted into reference membership. */
export function validRecordValues(workbook: Workbook, sheetId: string, values: Readonly<Record<string, string>>): boolean {
  const sheet = workbook.documents[sheetId];
  const model = sheet?.modelId ? workbook.dataModels?.[sheet.modelId] : undefined;
  if (!model) return false;
  const manual = model.columns.filter((column) => column.kind === 'manual');
  if (Object.keys(values).length !== manual.length || manual.some((column) => !Object.prototype.hasOwnProperty.call(values, column.id))) return false;
  return manual.every((column) => validRecordValue(workbook, sheetId, values[column.id], column.type));
}
