import type { Workbook } from '../core/model';
import { prepareUserFormula } from './formulaPreparation';
import { instantiateStoredModelFormula } from './modelFormulaInstance';
import { decodeStoredFormula, type StoredFormulaContent } from './storedFormula';

/** The complete template transport: one expression plus its persistent binding provenance. */
export type PreparedModelFormula = { content: StoredFormulaContent };

/** Declaration text is fresh input, never a serialized formula or a source of trusted IDs. */
export function prepareModelFormula(text: string, workbook: Workbook, sheetId: string): PreparedModelFormula {
  return { content: prepareUserFormula(text, workbook, sheetId) };
}

export function prepareModelFormulas(workbook: Workbook, sheetId: string): Readonly<Record<string, PreparedModelFormula>> {
  const modelId = workbook.documents[sheetId]?.modelId;
  const model = modelId ? workbook.dataModels?.[modelId] : undefined;
  return Object.fromEntries((model?.columns ?? []).flatMap((property) => property.kind === 'calculated'
    ? [[property.id, prepareModelFormula(property.formula, workbook, sheetId)]] : []));
}

export function modelFormulaDeclaration(template: PreparedModelFormula): string {
  return decodeStoredFormula(template.content).text;
}

export function instantiatePreparedModelFormula(template: PreparedModelFormula, workbook: Workbook, rowIndex: number): StoredFormulaContent {
  return instantiateStoredModelFormula(template.content, workbook, rowIndex);
}
