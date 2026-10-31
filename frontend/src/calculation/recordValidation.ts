import type { Workbook } from '@workbook/core/model';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { analyzeStoredFormula } from '@workbook/formula/storedFormulaAnalysis';
import { FormulaEvaluator } from './formulaEvaluator';
import { builtInFormulaFunctions } from './formulaBuiltins';
import { classifyCellValue, matchesModelColumnType } from './formulaValue';

/** Values are stored content; the candidate is never inserted into reference membership. */
export function validRecordValues(workbook: Workbook, sheetId: string, values: Readonly<Record<string, string>>): boolean {
  const sheet = workbook.documents[sheetId];
  const model = sheet?.modelId ? workbook.dataModels?.[sheet.modelId] : undefined;
  if (!model) return false;
  const manual = model.columns.filter((column) => column.kind === 'manual');
  if (Object.keys(values).length !== manual.length || manual.some((column) => !Object.prototype.hasOwnProperty.call(values, column.id))) return false;
  const evaluator = new FormulaEvaluator(calculationProjection(workbook), new Map(), undefined, builtInFormulaFunctions,
    (content, currentSheetId) => analyzeStoredFormula(content, workbook, currentSheetId).result);
  try {
    return manual.every((column) => {
      const content = values[column.id];
      const value = content.startsWith('=') ? evaluator.evaluateExpressionContent(content, sheetId) : classifyCellValue(content);
      return value.kind !== 'error' && matchesModelColumnType(value, column.type);
    });
  } catch {
    // Malformed stored opaque segments, including those reached transitively, are invalid input.
    return false;
  }
}
