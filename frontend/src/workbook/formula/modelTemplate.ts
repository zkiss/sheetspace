import { cellIdentityKey } from '../core/cellIdentity';
import type { SheetDocument, Workbook } from '../core/model';
import type { BoundModelFormula, ModelFormulaBindings } from '../core/modelFormula';
import { prepareModelFormulaContent } from './formulaPreparation';
import { instantiateStoredModelFormula } from './modelFormulaInstance';

export function bindModelFormula(raw: string, workbook: Workbook, sheetId: string): BoundModelFormula {
  return { content: prepareModelFormulaContent(raw, workbook, sheetId) };
}

export function bindModelFormulas(workbook: Workbook, sheetId: string): ModelFormulaBindings {
  const sheet = workbook.documents[sheetId];
  const model = sheet?.modelId ? workbook.dataModels?.[sheet.modelId] : undefined;
  return Object.fromEntries((model?.columns ?? []).flatMap((property) => property.kind === 'calculated'
    ? [[property.id, bindModelFormula(property.formula, workbook, sheetId)]] : []));
}

export function instantiateModelFormula(template: BoundModelFormula, workbook: Workbook, rowIndex: number, declaration: string, sheetId: string): string {
  return instantiateStoredModelFormula(template.content, workbook, rowIndex, declaration, sheetId);
}

/** Call only after every affected sheet has its final reconciled structure. */
export function instantiateModelFormulas(workbook: Workbook, sheetId: string, bindings = workbook.documents[sheetId].modelFormulaBindings ?? bindModelFormulas(workbook, sheetId), previous = workbook.documents[sheetId]): SheetDocument {
  return instantiateModelFormulaBindings(workbook, sheetId, bindings, previous, previous.modelFormulaBindings ?? {}, instantiateModelFormula);
}

/** Materialize calculated columns while retaining authoritative instances by output row identity. */
export function instantiateModelFormulaBindings<T>(workbook: Workbook, sheetId: string, bindings: Readonly<Record<string, T>>, previous: SheetDocument, previousBindings: Readonly<Record<string, T>>, instantiate: (template: T, workbook: Workbook, rowIndex: number, declaration: string, sheetId: string) => string): SheetDocument {
  const sheet = workbook.documents[sheetId];
  const cells = { ...sheet.content.cells };
  for (const [propertyId, template] of Object.entries(bindings)) {
    const property = sheet.modelId ? workbook.dataModels?.[sheet.modelId]?.columns.find((property) => property.id === propertyId) : undefined;
    if (property?.kind !== 'calculated') continue;
    const columnId = sheet.modelColumnBindings?.[propertyId];
    if (!columnId || !sheet.content.columns.includes(columnId)) continue;
    const continuing = previous.modelId === sheet.modelId && previous.modelColumnBindings?.[propertyId] === columnId
      && JSON.stringify(previousBindings[propertyId]) === JSON.stringify(template);
    sheet.content.rows.forEach((rowId, rowIndex) => {
      const key = cellIdentityKey({ rowId, columnId });
      const retained = continuing && previous.content.rows.includes(rowId) ? previous.content.cells[key] : undefined;
      cells[key] = retained ?? instantiate(template, workbook, rowIndex, property.formula, sheetId);
    });
  }
  return { ...sheet, content: { ...sheet.content, cells } };
}

/** Target deletion affects evaluation, never identities in surviving contents. */
export function refreshDerivedInstances(workbook: Workbook): Workbook {
  const documents = { ...workbook.documents };
  for (const sheet of Object.values(workbook.documents)) {
    const bindings = sheet.modelFormulaBindings;
    if (!bindings || Object.keys(bindings).length === 0) continue;
    documents[sheet.id] = instantiateModelFormulas(workbook, sheet.id, bindings);
  }
  return { ...workbook, documents };
}
