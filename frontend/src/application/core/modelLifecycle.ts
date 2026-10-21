import { FormulaCalculation } from '@calculation/formulaCalculation';
import { classifyCellValue, materializeFormulaValue, type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { cellKey } from '@workbook/core/address';
import { cellIdentityFromKey, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { DataModel, SheetDocument, Workbook } from '@workbook/core/model';
import type { ModelFormulaBindings } from '@workbook/core/modelFormula';
import { bindModelFormula, bindModelFormulas, instantiateModelFormulas, refreshDerivedInstances } from '@workbook/formula/modelTemplate';
import { formulaRawForStorage, formulaReferenceTokens } from '@workbook/formula/reference';
import { validateDataModel, type ModelMutationResult } from '@workbook/mutations/dataModel';
import { calculationProjection } from '@workbook/read/calculationProjection';

/** Must allocate globally fresh identities, including identities removed by earlier edits. */
export type CreateModelColumnId = () => string;

/** Explicit lifecycle operations; metadata-only loading/storage must not call these. */
export function bindSheetToModel(workbook: Workbook, sheetId: string, modelId: string, createColumnId: CreateModelColumnId): ModelMutationResult {
  const sheet = workbook.documents[sheetId];
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const model = workbook.dataModels?.[modelId];
  if (!model) return { ok: false, reason: 'unknown-model' };
  const invalid = validateDataModel(model);
  if (invalid) return invalid;
  if (sheet.modelId === modelId) return { ok: true, value: workbook };
  const source = canonicalizeWorkbookReferences(workbook);
  const materialized = sheet.modelId ? freezeCalculatedColumns(source, source.documents[sheetId]!, calculate(source)) : source.documents[sheetId]!;
  const columns = model.columns.map((_, index) => materialized.content.columns[index] ?? createColumnId());
  const reconciled = reshapeSheet(materialized, model, columns);
  const structured = withSheet(source, reconciled);
  const bound = refreshModelSheet(structured, sheetId, bindModelFormulas(structured, sheetId));
  return { ok: true, value: refreshDerivedInstances(bound) };
}

export function unbindSheetFromModel(workbook: Workbook, sheetId: string): ModelMutationResult {
  const sheet = workbook.documents[sheetId];
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (!sheet.modelId) return { ok: true, value: workbook };
  const source = canonicalizeWorkbookReferences(workbook);
  const frozen = freezeCalculatedColumns(source, source.documents[sheetId]!, calculate(source));
  const unbound = { ...frozen };
  delete unbound.modelId;
  delete unbound.modelColumnBindings;
  delete unbound.modelFormulaBindings;
  return { ok: true, value: refreshDerivedInstances(withSheet(source, unbound)) };
}

/** Reconcile every structure first, then resolve templates against the complete next workbook. */
export function replaceModelDeclaration(workbook: Workbook, model: DataModel, createColumnId: CreateModelColumnId): ModelMutationResult {
  const previous = workbook.dataModels?.[model.id];
  if (!previous) return { ok: false, reason: 'unknown-model' };
  const invalid = validateDataModel(model);
  if (invalid) return invalid;
  if (JSON.stringify(previous) === JSON.stringify(model)) return { ok: true, value: workbook };
  const source = canonicalizeWorkbookReferences(workbook);
  const affected = Object.values(source.documents).filter((sheet) => sheet.modelId === model.id);
  const snapshot = calculate(source);
  const oldBindings = new Map(affected.map((sheet) => [sheet.id, sheet.modelFormulaBindings ?? bindModelFormulas(source, sheet.id)]));
  let next: Workbook = { ...source, dataModels: { ...source.dataModels, [model.id]: model } };
  for (const sheet of affected) {
    const frozen = freezeCalculatedColumns(source, sheet, snapshot, new Set(model.columns.filter((property) => property.kind === 'manual').map((property) => property.id)));
    const columns = model.columns.map((property) => {
      const retained = sheet.modelColumnBindings?.[property.id];
      return retained && sheet.content.columns.includes(retained) ? retained : createColumnId();
    });
    next = withSheet(next, reshapeSheet(frozen, model, columns));
  }
  const structured = next;
  for (const sheet of affected) {
    const bindings: ModelFormulaBindings = Object.fromEntries(model.columns.flatMap((property) => {
      if (property.kind !== 'calculated') return [];
      const old = oldBindings.get(sheet.id)![property.id];
      return [[property.id, old?.raw === property.formula ? old : bindModelFormula(property.formula, structured, sheet.id)]];
    }));
    next = refreshModelSheet(next, sheet.id, bindings);
  }
  return { ok: true, value: refreshDerivedInstances(next) };
}

function refreshModelSheet(workbook: Workbook, sheetId: string, bindings: ModelFormulaBindings): Workbook {
  return withSheet(workbook, { ...instantiateModelFormulas(workbook, sheetId, bindings), modelFormulaBindings: bindings });
}

function calculate(workbook: Workbook): FormulaEvaluationSnapshot {
  return new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' });
}

function freezeCalculatedColumns(workbook: Workbook, sheet: SheetDocument, snapshot: FormulaEvaluationSnapshot, propertyIds?: ReadonlySet<string>): SheetDocument {
  const model = workbook.dataModels?.[sheet.modelId!];
  const cells = { ...sheet.content.cells };
  for (const property of model?.columns ?? []) {
    if (property.kind !== 'calculated' || (propertyIds && !propertyIds.has(property.id))) continue;
    const columnId = sheet.modelColumnBindings?.[property.id];
    const columnIndex = columnId === undefined ? -1 : sheet.content.columns.indexOf(columnId);
    if (columnIndex < 0) continue;
    sheet.content.rows.forEach((rowId, rowIndex) => {
      const key = cellIdentityKey({ rowId, columnId: columnId! });
      const value = snapshot[sheet.id]![cellKey({ rowIndex, columnIndex })];
      const raw = materializeFormulaValue(value ?? classifyCellValue(sheet.content.cells[key] ?? ''));
      if (raw === '') delete cells[key];
      else cells[key] = raw;
    });
  }
  return { ...sheet, content: { ...sheet.content, cells } };
}

function reshapeSheet(sheet: SheetDocument, model: DataModel, columns: string[]): SheetDocument {
  const retained = new Set(columns);
  const keepCell = (key: string) => retained.has(cellIdentityFromKey(key)!.columnId);
  const filter = <T,>(values: Record<string, T>, keep: (key: string) => boolean) => Object.fromEntries(Object.entries(values).filter(([key]) => keep(key)));
  const formats = sheet.presentation.formatOverrides;
  return {
    ...sheet,
    modelId: model.id,
    modelColumnBindings: Object.fromEntries(model.columns.map((property, index) => [property.id, columns[index]!])),
    modelFormulaBindings: undefined,
    content: { ...sheet.content, columns, cells: filter(sheet.content.cells, keepCell) },
    presentation: {
      ...sheet.presentation,
      columnWidths: filter(sheet.presentation.columnWidths, (id) => retained.has(id)),
      ...(formats ? { formatOverrides: { ...formats, columns: filter(formats.columns, (id) => retained.has(id)), cells: filter(formats.cells, keepCell) } } : {}),
    },
  };
}

function withSheet(workbook: Workbook, sheet: SheetDocument): Workbook {
  return { ...workbook, documents: { ...workbook.documents, [sheet.id]: sheet } };
}

function canonicalizeWorkbookReferences(workbook: Workbook): Workbook {
  let next = workbook;
  for (const sheet of Object.values(workbook.documents)) {
    const cells = Object.fromEntries(Object.entries(sheet.content.cells).map(([key, raw]) => [key, canonicalizeCellReferences(raw, workbook, sheet.id)]));
    if (Object.keys(cells).some((key) => cells[key] !== sheet.content.cells[key])) next = withSheet(next, { ...sheet, content: { ...sheet.content, cells } });
  }
  return next;
}

function canonicalizeCellReferences(raw: string, workbook: Workbook, sheetId: string): string {
  // The ordinary input converter renders unresolved references as bare #REF!, which
  // is not executable reference syntax. Keep lifecycle errors parseable instead.
  return formulaReferenceTokens(raw).sort((a, b) => b.sourceSpan.start - a.sourceSpan.start).reduce((value, reference) => {
    const { start, end } = reference.sourceSpan;
    if (reference.qualifier.kind === 'broken') return value;
    const canonical = formulaRawForStorage(`=${raw.slice(start, end)}`, workbook, sheetId).slice(1);
    return value.slice(0, start) + (canonical === '#REF!' ? '@#REF!A[1]' : canonical) + value.slice(end);
  }, raw);
}
