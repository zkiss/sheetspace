import { FormulaCalculation } from '@calculation/formulaCalculation';
import { classifyCellValue, materializeFormulaValue, type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { cellKey } from '@workbook/core/address';
import { cellIdentityFromKey, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { DataModel, SheetDocument, Workbook } from '@workbook/core/model';
import type { ModelFormulaBindings } from '@workbook/core/modelFormula';
import { bindModelFormula, bindModelFormulas, instantiateModelFormulas, refreshDerivedInstances } from '@workbook/formula/modelTemplate';
import { modelFormulaDeclaration } from '@workbook/formula/preparedModelTemplate';
import { validateDataModel } from '@workbook/mutations/dataModel';
import { calculationProjection } from '@workbook/read/calculationProjection';

/** Must allocate globally fresh identities, including identities removed by earlier edits. */
export type CreateModelColumnId = () => string;

/** Shared structure and lifecycle orchestration; transport-specific behavior is injected. */
export interface LifecycleAdapter<S, B> {
  workbook(state: S): Workbook;
  source(state: S): S;
  bindings(state: S, sheetId: string): Readonly<Record<string, B>>;
  prepare(workbook: Workbook, sheetId: string, formula: string): B;
  prepareAll(workbook: Workbook, sheetId: string): Readonly<Record<string, B>>;
  declaration(binding: B): string;
  calculate(workbook: Workbook): FormulaEvaluationSnapshot;
  finish(state: S, workbook: Workbook, changes: Readonly<Record<string, Readonly<Record<string, B>> | undefined>>): S;
}

type LifecycleResult<S> = { ok: true; value: S } | { ok: false; reason: 'unknown-sheet' | 'unknown-model' | 'duplicate-model' | 'invalid-model' };

export function lifecycleOperations<S, B>(adapter: LifecycleAdapter<S, B>) {
  return {
    bind(state: S, sheetId: string, modelId: string, createColumnId: CreateModelColumnId): LifecycleResult<S> {
      const workbook = adapter.workbook(state);
      const sheet = workbook.documents[sheetId];
      if (!sheet) return { ok: false, reason: 'unknown-sheet' };
      const model = workbook.dataModels?.[modelId];
      if (!model) return { ok: false, reason: 'unknown-model' };
      const invalid = validateDataModel(model);
      if (invalid && !invalid.ok) return invalid;
      if (sheet.modelId === modelId) return { ok: true, value: state };
      const sourceState = adapter.source(state);
      const source = adapter.workbook(sourceState);
      const materialized = sheet.modelId ? freezeCalculatedColumns(source, source.documents[sheetId]!, adapter.calculate(source)) : source.documents[sheetId]!;
      const columns = model.columns.map((_, index) => materialized.content.columns[index] ?? createColumnId());
      const structured = withSheet(source, reshapeSheet(materialized, model, columns));
      return { ok: true, value: adapter.finish(sourceState, structured, { [sheetId]: adapter.prepareAll(structured, sheetId) }) };
    },
    unbind(state: S, sheetId: string): LifecycleResult<S> {
      const sheet = adapter.workbook(state).documents[sheetId];
      if (!sheet) return { ok: false, reason: 'unknown-sheet' };
      if (!sheet.modelId) return { ok: true, value: state };
      const sourceState = adapter.source(state);
      const source = adapter.workbook(sourceState);
      const unbound = { ...freezeCalculatedColumns(source, source.documents[sheetId]!, adapter.calculate(source)) };
      delete unbound.modelId;
      delete unbound.modelColumnBindings;
      delete unbound.modelFormulaBindings;
      return { ok: true, value: adapter.finish(sourceState, withSheet(source, unbound), { [sheetId]: undefined }) };
    },
    replace(state: S, model: DataModel, createColumnId: CreateModelColumnId): LifecycleResult<S> {
      const workbook = adapter.workbook(state);
      const previous = workbook.dataModels?.[model.id];
      if (!previous) return { ok: false, reason: 'unknown-model' };
      const invalid = validateDataModel(model);
      if (invalid && !invalid.ok) return invalid;
      if (JSON.stringify(previous) === JSON.stringify(model)) return { ok: true, value: state };
      const sourceState = adapter.source(state);
      const source = adapter.workbook(sourceState);
      const affected = Object.values(source.documents).filter((sheet) => sheet.modelId === model.id);
      const snapshot = adapter.calculate(source);
      const oldBindings = new Map(affected.map((sheet) => [sheet.id, adapter.bindings(sourceState, sheet.id)]));
      let next: Workbook = { ...source, dataModels: { ...source.dataModels, [model.id]: model } };
      for (const sheet of affected) {
        const frozen = freezeCalculatedColumns(source, sheet, snapshot, new Set(model.columns.filter((property) => property.kind === 'manual').map((property) => property.id)));
        const columns = model.columns.map((property) => {
          const retained = sheet.modelColumnBindings?.[property.id];
          return retained && sheet.content.columns.includes(retained) ? retained : createColumnId();
        });
        next = withSheet(next, reshapeSheet(frozen, model, columns));
      }
      const changes: Record<string, Readonly<Record<string, B>>> = {};
      for (const sheet of affected) {
        changes[sheet.id] = Object.fromEntries(model.columns.flatMap((property) => {
          if (property.kind !== 'calculated') return [];
          const old = oldBindings.get(sheet.id)![property.id];
          return [[property.id, old && adapter.declaration(old) === property.formula ? old : adapter.prepare(next, sheet.id, property.formula)]];
        }));
      }
      return { ok: true, value: adapter.finish(sourceState, next, changes) };
    },
  };
}

const storedLifecycle = lifecycleOperations<Workbook, ModelFormulaBindings[string]>({
  workbook: (workbook) => workbook,
  source: (workbook) => workbook,
  bindings: (workbook, sheetId) => workbook.documents[sheetId]!.modelFormulaBindings ?? bindModelFormulas(workbook, sheetId),
  prepare: (workbook, sheetId, formula) => bindModelFormula(formula, workbook, sheetId),
  prepareAll: bindModelFormulas,
  declaration: modelFormulaDeclaration,
  calculate,
  finish: (source, structured, changes) => {
    let next = structured;
    for (const [sheetId, bindings] of Object.entries(changes)) {
      if (bindings) next = refreshModelSheet(next, sheetId, bindings, source.documents[sheetId]);
    }
    return refreshDerivedInstances(next);
  },
});

export const bindSheetToModel = storedLifecycle.bind;
export const unbindSheetFromModel = storedLifecycle.unbind;
export const replaceModelDeclaration = storedLifecycle.replace;

function refreshModelSheet(workbook: Workbook, sheetId: string, bindings: ModelFormulaBindings, previous = workbook.documents[sheetId]): Workbook {
  return withSheet(workbook, { ...instantiateModelFormulas(workbook, sheetId, bindings, previous), modelFormulaBindings: bindings });
}

function calculate(workbook: Workbook): FormulaEvaluationSnapshot {
  return new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' });
}

export function freezeCalculatedColumns(workbook: Workbook, sheet: SheetDocument, snapshot: FormulaEvaluationSnapshot, propertyIds?: ReadonlySet<string>): SheetDocument {
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

export function reshapeSheet(sheet: SheetDocument, model: DataModel, columns: string[]): SheetDocument {
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

export function withSheet(workbook: Workbook, sheet: SheetDocument): Workbook {
  return { ...workbook, documents: { ...workbook.documents, [sheet.id]: sheet } };
}
