import { cellIdentityKey } from '../core/cellIdentity';
import type { ColumnId, DataModel, SheetDocument, SheetId, Workbook } from '../core/model';
import { copyCanonicalFormula, formulaRawForStorage, workbookFormulaReferenceResolver } from '../formula/reference';
import { parseFormula } from '../formula/syntax';

export type ModelWorkbook = Workbook;
export type ModelMutationResult = { ok: true; value: ModelWorkbook } | { ok: false; reason: 'unknown-model' | 'unknown-sheet' | 'duplicate-model' | 'duplicate-property-name' | 'already-bound' | 'column-id-required' | 'invalid-formula' };

/** Model formulas are authored as first-row spreadsheet formulas and copied with normal A1 rebasing. */
export function validateDataModel(model: DataModel): ModelMutationResult | undefined {
  const names = model.properties.map((property) => property.name.trim());
  if (names.some((name) => !name) || new Set(names).size !== names.length) {
    return { ok: false, reason: 'duplicate-property-name' };
  }
  return model.properties.some((property) => property.kind === 'calculated' && parseFormula(property.formula).kind !== 'formula')
    ? { ok: false, reason: 'invalid-formula' }
    : undefined;
}

/** Adds a declarative definition without changing any sheet until an explicit bind. */
export function addDataModel(workbook: ModelWorkbook, model: DataModel): ModelMutationResult {
  if (workbook.dataModels?.[model.id]) return { ok: false, reason: 'duplicate-model' };
  const invalid = validateDataModel(model);
  if (invalid) return invalid;
  return { ok: true, value: { ...workbook, dataModels: { ...workbook.dataModels, [model.id]: model } } };
}

export function bindSheetToDataModel(
  workbook: ModelWorkbook,
  sheetId: SheetId,
  modelId: string,
  newColumnIds: readonly ColumnId[],
): ModelMutationResult {
  const model = workbook.dataModels?.[modelId];
  const sheet = workbook.documents[sheetId];
  if (!model) return { ok: false, reason: 'unknown-model' };
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (sheet.dataModelId) return { ok: false, reason: 'already-bound' };
  const invalid = validateDataModel(model);
  if (invalid) return invalid;
  const addedCount = Math.max(0, model.properties.length - sheet.content.columns.length);
  if (newColumnIds.length !== addedCount || new Set(newColumnIds).size !== newColumnIds.length || newColumnIds.some((id) => sheet.content.columns.includes(id))) return { ok: false, reason: 'column-id-required' };
  const columns = [...sheet.content.columns.slice(0, model.properties.length), ...newColumnIds];
  return applyBoundShape(workbook, sheet, model, columns);
}

/** Callers supply evaluated values so this domain mutation stays independent of calculation. */
export function unbindSheetFromDataModel(workbook: ModelWorkbook, sheetId: SheetId, materializedValues: Readonly<Record<string, string>>): ModelMutationResult {
  const sheet = workbook.documents[sheetId];
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (!sheet.dataModelId) return { ok: true, value: workbook };
  const model = workbook.dataModels?.[sheet.dataModelId];
  if (!model) return { ok: false, reason: 'unknown-model' };
  const cells = { ...sheet.content.cells };
  for (const [index, property] of model.properties.entries()) {
    if (property.kind !== 'calculated') continue;
    const columnId = sheet.content.columns[index];
    if (!columnId) continue;
    for (const rowId of sheet.content.rows) {
      const key = cellIdentityKey({ rowId, columnId });
      const value = materializedValues[key];
      if (value === undefined || value.length === 0) delete cells[key]; else cells[key] = value;
    }
  }
  return { ok: true, value: { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, dataModelId: undefined, content: { ...sheet.content, cells } } } } };
}

/** Replaces a model and atomically reshapes each bound sheet. Unchanged property names retain columns. */
export function replaceDataModel(
  workbook: ModelWorkbook,
  next: DataModel,
  newColumnIdsBySheet: Readonly<Record<string, readonly ColumnId[]>>,
): ModelMutationResult {
  const current = workbook.dataModels?.[next.id];
  if (!current) return { ok: false, reason: 'unknown-model' };
  const invalid = validateDataModel(next);
  if (invalid) return invalid;
  let candidate: ModelWorkbook = { ...workbook, dataModels: { ...workbook.dataModels, [next.id]: next } };
  const oldIndexes = new Map(current.properties.map((property, index) => [property.name, index]));
  for (const sheet of Object.values(workbook.documents)) {
    if (sheet.dataModelId !== next.id) continue;
    const supplied = newColumnIdsBySheet[sheet.id] ?? [];
    const retained = next.properties.flatMap((property) => {
      const oldIndex = oldIndexes.get(property.name);
      return oldIndex === undefined ? [] : [sheet.content.columns[oldIndex]!];
    });
    const required = next.properties.length - retained.length;
    if (supplied.length !== required || new Set(supplied).size !== supplied.length || supplied.some((id) => sheet.content.columns.includes(id))) return { ok: false, reason: 'column-id-required' };
    const columns: ColumnId[] = [];
    let suppliedIndex = 0;
    for (const property of next.properties) {
      const oldIndex = oldIndexes.get(property.name);
      columns.push(oldIndex === undefined ? supplied[suppliedIndex++]! : sheet.content.columns[oldIndex]!);
    }
    const applied = applyBoundShape(candidate, candidate.documents[sheet.id]!, next, columns, current);
    if (!applied.ok) return applied;
    candidate = applied.value;
  }
  return { ok: true, value: candidate };
}

function applyBoundShape(workbook: ModelWorkbook, sheet: SheetDocument, model: DataModel, columns: readonly ColumnId[], previousModel?: DataModel): ModelMutationResult {
  const cells: Record<string, string> = {};
  const propertyByColumn = new Map(columns.map((column, index) => [column, model.properties[index]!]));
  for (const [key, raw] of Object.entries(sheet.content.cells)) {
    const [, columnId] = key.split('\u0000');
    const property = propertyByColumn.get(columnId!);
    const previousIndex = previousModel?.properties.findIndex((candidate) => candidate.name === property?.name);
    const wasCalculated = previousIndex !== undefined && previousIndex >= 0
      && previousModel?.properties[previousIndex]?.kind === 'calculated';
    if (property?.kind !== 'calculated' && property && !wasCalculated) cells[key] = raw;
  }
  let shaped: SheetDocument = {
    ...sheet,
    dataModelId: model.id,
    content: { ...sheet.content, columns: [...columns], cells },
    presentation: {
      ...sheet.presentation,
      columnWidths: Object.fromEntries(Object.entries(sheet.presentation.columnWidths).filter(([id]) => columns.includes(id))),
      formatOverrides: sheet.presentation.formatOverrides && {
        ...sheet.presentation.formatOverrides,
        columns: Object.fromEntries(Object.entries(sheet.presentation.formatOverrides.columns).filter(([id]) => columns.includes(id))),
        cells: Object.fromEntries(Object.entries(sheet.presentation.formatOverrides.cells)
          .filter(([key]) => columns.includes(key.split('\u0000')[1]!))),
      },
    },
  };
  let candidate: ModelWorkbook = { ...workbook, documents: { ...workbook.documents, [sheet.id]: shaped } };
  for (let propertyIndex = 0; propertyIndex < model.properties.length; propertyIndex += 1) {
    const property = model.properties[propertyIndex]!;
    if (property.kind !== 'calculated' || shaped.content.rows.length === 0) continue;
    const source = { rowId: shaped.content.rows[0]!, columnId: columns[propertyIndex]! };
    const firstRaw = formulaRawForStorage(property.formula, candidate, shaped.id);
    if (!firstRaw.startsWith('=')) return { ok: false, reason: 'invalid-formula' };
    shaped = writeRaw(shaped, source.rowId, source.columnId, firstRaw);
    candidate = { ...candidate, documents: { ...candidate.documents, [shaped.id]: shaped } };
    for (const rowId of shaped.content.rows.slice(1)) {
      const copied = copyCanonicalFormula(firstRaw, source, { rowId, columnId: source.columnId }, workbookFormulaReferenceResolver(candidate, shaped.id));
      if (!copied.ok) return { ok: false, reason: 'invalid-formula' };
      shaped = writeRaw(shaped, rowId, source.columnId, copied.raw);
      candidate = { ...candidate, documents: { ...candidate.documents, [shaped.id]: shaped } };
    }
  }
  return { ok: true, value: candidate };
}

function writeRaw(sheet: SheetDocument, rowId: string, columnId: string, raw: string): SheetDocument {
  return { ...sheet, content: { ...sheet.content, cells: { ...sheet.content.cells, [cellIdentityKey({ rowId, columnId })]: raw } } };
}
