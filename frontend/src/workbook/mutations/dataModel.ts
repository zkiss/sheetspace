import type { DataModel, SheetDocument, SheetId, Workbook } from '../core/model';
import { projectRenamedModelFormulas } from '../formula/renamedModelFormulas';

export type ModelMutationResult = { ok: true; value: Workbook } | { ok: false; reason: 'unknown-model' | 'unknown-sheet' | 'duplicate-model' | 'invalid-model' | 'data-outside-model' };

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
  if (Object.values(workbook.documents).some((sheet) => sheet.modelId === model.id && hasModelNameCollision(sheet, model, sheet.modelColumnBindings ?? {}))) return { ok: false, reason: 'invalid-model' };
  return {
    ok: true,
    value: projectRenamedModelFormulas(workbook, {
      ...workbook,
      dataModels: { ...workbook.dataModels, [model.id]: model },
      documents: Object.fromEntries(Object.entries(workbook.documents).map(([sheetId, sheet]) => [
        sheetId, retainPropertyBindings(sheet, model, workbook.dataModels![model.id]),
      ])),
    }),
  };
}

/**
 * Attaches, rebinds or unbinds a model for one sheet.
 *
 * This mirrors the sheet-model contract: only manual models attach here, an explicit
 * mapping is never dropped, and a same-model request without a mapping recomputes the
 * default declaration-order mapping and applies it when it differs.
 */
export function setSheetModelId(
  workbook: Workbook,
  sheetId: SheetId,
  modelId?: string,
  modelColumnBindings?: Readonly<Record<string, string>>,
): ModelMutationResult {
  const sheet = workbook.documents[sheetId];
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (modelId !== undefined && !workbook.dataModels?.[modelId]) return { ok: false, reason: 'unknown-model' };
  const model = modelId === undefined ? undefined : workbook.dataModels![modelId]!;
  if (model?.columns.some((column) => column.kind === 'calculated')) return { ok: false, reason: 'invalid-model' };
  const bindings = model === undefined ? undefined : modelColumnBindings ?? defaultModelColumnBindings(model, sheet);
  if (model !== undefined && bindings && !validModelColumnBindings(model, sheet, bindings)) {
    return { ok: false, reason: 'invalid-model' };
  }
  if (model && bindings && hasModelNameCollision(sheet, model, bindings)) return { ok: false, reason: 'invalid-model' };
  if (sheet.modelId === modelId && sameModelColumnBindings(sheet.modelColumnBindings, bindings)) {
    return { ok: true, value: workbook };
  }
  const updatedSheet = { ...sheet, modelId, modelColumnBindings: bindings, modelFormulaBindings: undefined };
  return { ok: true, value: { ...workbook, documents: { ...workbook.documents, [sheetId]: updatedSheet } } };
}

export function hasModelNameCollision(sheet: SheetDocument, model: DataModel, bindings: Readonly<Record<string, string | undefined>>): boolean {
  return model.columns.some((property) => {
    const bound = bindings[property.id];
    return bound !== undefined && sheet.content.columns.includes(bound) && Object.entries(sheet.columnNames ?? {}).some(
      ([columnId, name]) => sheet.content.columns.includes(columnId) && (columnId === bound || name === property.name),
    );
  });
}

/** Declaration order binds the first properties to the first columns of the sheet. */
function defaultModelColumnBindings(model: DataModel, sheet: SheetDocument): Record<string, string> {
  return Object.fromEntries(model.columns.slice(0, sheet.content.columns.length)
    .map((property, index) => [property.id, sheet.content.columns[index]!]));
}

function validModelColumnBindings(model: DataModel, sheet: SheetDocument, bindings: Readonly<Record<string, string>>): boolean {
  const propertyIds = new Set(model.columns.map((column) => column.id));
  const entries = Object.entries(bindings);
  return entries.every(([propertyId, columnId]) => propertyIds.has(propertyId) && sheet.content.columns.includes(columnId))
    && new Set(entries.map(([, columnId]) => columnId)).size === entries.length;
}

function sameModelColumnBindings(current: Readonly<Record<string, string>> | undefined, next: Readonly<Record<string, string>> | undefined): boolean {
  const currentEntries = Object.entries(current ?? {});
  const nextEntries = Object.entries(next ?? {});
  if (currentEntries.length !== nextEntries.length) return false;
  return currentEntries.every(([propertyId, columnId]) => next?.[propertyId] === columnId);
}

function retainPropertyBindings(sheet: SheetDocument, model: DataModel, previous: DataModel): SheetDocument {
  if (sheet.modelId !== model.id) return sheet;
  const propertyIds = new Set(model.columns.map((column) => column.id));
  return {
    ...sheet,
    ...(sheet.modelColumnBindings === undefined ? {} : { modelColumnBindings: Object.fromEntries(Object.entries(sheet.modelColumnBindings).filter(([propertyId]) => propertyIds.has(propertyId))) }),
    ...(sheet.modelFormulaBindings === undefined ? {} : { modelFormulaBindings: Object.fromEntries(Object.entries(sheet.modelFormulaBindings).filter(([propertyId]) => model.columns.some((property) => property.id === propertyId && property.kind === 'calculated' && previous.columns.some((old) => old.id === propertyId && old.kind === 'calculated' && old.formula === property.formula)))) }),
  };
}

function nonBlank(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
