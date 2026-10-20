import type { DataModel, SheetDocument, SheetId, Workbook } from '../core/model';

export type ModelMutationResult = { ok: true; value: Workbook } | { ok: false; reason: 'unknown-model' | 'unknown-sheet' | 'duplicate-model' | 'invalid-model' };

/** Validates declarations only: model metadata never changes sheet content. */
export function validateDataModel(model: DataModel): ModelMutationResult | undefined {
  if (!nonBlank(model.id) || !nonBlank(model.name)) return { ok: false, reason: 'invalid-model' };
  const ids = model.columns.map((column) => column.id);
  const names = model.columns.map((column) => column.name.trim());
  if (ids.some((id) => !nonBlank(id)) || names.some((name) => !name) || new Set(ids).size !== ids.length || new Set(names).size !== names.length) return { ok: false, reason: 'invalid-model' };
  if (model.columns.some((column) => !['manual', 'calculated'].includes(column.kind) || !['string', 'int', 'float', 'boolean'].includes(column.type) || (column.kind === 'calculated' ? !nonBlank(column.formula) : 'formula' in column))) return { ok: false, reason: 'invalid-model' };
  return undefined;
}

export function addDataModel(workbook: Workbook, model: DataModel): ModelMutationResult {
  if (workbook.dataModels?.[model.id]) return { ok: false, reason: 'duplicate-model' };
  return validateDataModel(model) ?? { ok: true, value: { ...workbook, dataModels: { ...workbook.dataModels, [model.id]: model } } };
}

export function replaceDataModel(workbook: Workbook, model: DataModel): ModelMutationResult {
  if (!workbook.dataModels?.[model.id]) return { ok: false, reason: 'unknown-model' };
  const invalid = validateDataModel(model);
  if (invalid) return invalid;
  return {
    ok: true,
    value: {
      ...workbook,
      dataModels: { ...workbook.dataModels, [model.id]: model },
      documents: Object.fromEntries(Object.entries(workbook.documents).map(([sheetId, sheet]) => [
        sheetId, retainPropertyBindings(sheet, model),
      ])),
    },
  };
}

export function setSheetModelId(workbook: Workbook, sheetId: SheetId, modelId?: string): ModelMutationResult {
  const sheet = workbook.documents[sheetId];
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (modelId !== undefined && !workbook.dataModels?.[modelId]) return { ok: false, reason: 'unknown-model' };
  if (sheet.modelId === modelId) return { ok: true, value: workbook };
  const model = modelId === undefined ? undefined : workbook.dataModels![modelId]!;
  const bindings = model === undefined
    ? undefined
    : Object.fromEntries(model.columns.slice(0, sheet.content.columns.length)
      .map((property, index) => [property.id, sheet.content.columns[index]!]));
  const updatedSheet = { ...sheet, modelId, modelColumnBindings: bindings, modelFormulaBindings: undefined };
  return { ok: true, value: { ...workbook, documents: { ...workbook.documents, [sheetId]: updatedSheet } } };
}

function retainPropertyBindings(sheet: SheetDocument, model: DataModel): SheetDocument {
  if (sheet.modelId !== model.id) return sheet;
  const propertyIds = new Set(model.columns.map((column) => column.id));
  return {
    ...sheet,
    ...(sheet.modelColumnBindings === undefined ? {} : { modelColumnBindings: Object.fromEntries(Object.entries(sheet.modelColumnBindings).filter(([propertyId]) => propertyIds.has(propertyId))) }),
    ...(sheet.modelFormulaBindings === undefined ? {} : { modelFormulaBindings: Object.fromEntries(Object.entries(sheet.modelFormulaBindings).filter(([propertyId, template]) => model.columns.some((property) => property.id === propertyId && property.kind === 'calculated' && property.formula === template.raw))) }),
  };
}

function nonBlank(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
