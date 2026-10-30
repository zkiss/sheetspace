import type { SheetDocument, Workbook } from '../core/model';
import { prepareModelFormulaContent } from './formulaPreparation';
import { instantiateStoredModelFormula } from './modelFormulaInstance';
import { instantiateModelFormulaBindings } from './modelTemplate';
import type { StoredFormulaContent } from '../core/storedFormulaContent';

/** The complete template transport: one authoritative inline expression. */
export type PreparedModelFormula = import('../core/modelFormula').BoundModelFormula;

/** Declaration text is fresh input, never a serialized formula or a source of trusted IDs. */
export function prepareModelFormula(text: string, workbook: Workbook, sheetId: string): PreparedModelFormula {
  return { content: prepareModelFormulaContent(text, workbook, sheetId) };
}

export function prepareModelFormulas(workbook: Workbook, sheetId: string): Readonly<Record<string, PreparedModelFormula>> {
  const modelId = workbook.documents[sheetId]?.modelId;
  const model = modelId ? workbook.dataModels?.[modelId] : undefined;
  return Object.fromEntries((model?.columns ?? []).flatMap((property) => property.kind === 'calculated'
    ? [[property.id, prepareModelFormula(property.formula, workbook, sheetId)]] : []));
}

export function instantiatePreparedModelFormula(template: PreparedModelFormula, workbook: Workbook, rowIndex: number, declaration: string, sheetId: string): StoredFormulaContent {
  return instantiateStoredModelFormula(template.content, workbook, rowIndex, declaration, sheetId);
}

export function instantiatePreparedModelFormulas(workbook: Workbook, sheetId: string, bindings: Readonly<Record<string, PreparedModelFormula>>, previous: SheetDocument, previousBindings: Readonly<Record<string, PreparedModelFormula>>): SheetDocument {
  return instantiateModelFormulaBindings(workbook, sheetId, bindings, previous, previousBindings, instantiatePreparedModelFormula);
}
