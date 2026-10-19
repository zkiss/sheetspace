import type { DataModel, SheetId, Workbook } from '../core/model';

export type ModelMutationResult = { ok: true; value: Workbook } | { ok: false; reason: 'unknown-model' | 'unknown-sheet' | 'duplicate-model' | 'invalid-model' };

/** Validates declarations only: model metadata never changes sheet content. */
export function validateDataModel(model: DataModel): ModelMutationResult | undefined {
  if (!nonBlank(model.id) || !nonBlank(model.name)) return { ok: false, reason: 'invalid-model' };
  const ids = model.columns.map((column) => column.id);
  const names = model.columns.map((column) => column.name.trim());
  if (ids.some((id) => !nonBlank(id)) || names.some((name) => !name) || new Set(ids).size !== ids.length || new Set(names).size !== names.length) return { ok: false, reason: 'invalid-model' };
  if (model.columns.some((column) => !['string', 'int', 'float', 'boolean'].includes(column.type) || (column.kind === 'calculated' ? !nonBlank(column.formula) : 'formula' in column))) return { ok: false, reason: 'invalid-model' };
  return undefined;
}

export function addDataModel(workbook: Workbook, model: DataModel): ModelMutationResult {
  if (workbook.dataModels?.[model.id]) return { ok: false, reason: 'duplicate-model' };
  return validateDataModel(model) ?? { ok: true, value: { ...workbook, dataModels: { ...workbook.dataModels, [model.id]: model } } };
}

export function replaceDataModel(workbook: Workbook, model: DataModel): ModelMutationResult {
  if (!workbook.dataModels?.[model.id]) return { ok: false, reason: 'unknown-model' };
  return validateDataModel(model) ?? { ok: true, value: { ...workbook, dataModels: { ...workbook.dataModels, [model.id]: model } } };
}

export function setSheetModelId(workbook: Workbook, sheetId: SheetId, modelId?: string): ModelMutationResult {
  const sheet = workbook.documents[sheetId];
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (modelId !== undefined && !workbook.dataModels?.[modelId]) return { ok: false, reason: 'unknown-model' };
  return { ok: true, value: { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, modelId } } } };
}

function nonBlank(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
