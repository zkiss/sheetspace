import { FormulaCalculation } from '@calculation/formulaCalculation';
import type { DataModel, Workbook } from '@workbook/core/model';
import { instantiatePreparedModelFormulas, modelFormulaDeclaration, prepareModelFormula, prepareModelFormulas, type PreparedModelFormula } from '@workbook/formula/preparedModelTemplate';
import { validateDataModel } from '@workbook/mutations/dataModel';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { freezeCalculatedColumns, reshapeSheet, withSheet, type CreateModelColumnId } from './modelLifecycle';

type Bindings = Readonly<Record<string, PreparedModelFormula>>;
export type PreparedLifecycle = { workbook: Workbook; bindings: Readonly<Record<string, Bindings>> };
type Result = { ok: true; value: PreparedLifecycle } | { ok: false; reason: 'unknown-model' | 'unknown-sheet' | 'duplicate-model' | 'invalid-model' };

function freeze(workbook: Workbook, sheetId: string, propertyIds?: ReadonlySet<string>) {
  const snapshot = new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' });
  return freezeCalculatedColumns(workbook, workbook.documents[sheetId]!, snapshot, propertyIds);
}

export function refreshPreparedInstances(state: PreparedLifecycle, previous: Workbook = state.workbook, previousBindings = state.bindings): PreparedLifecycle {
  let workbook = state.workbook;
  for (const [sheetId, bindings] of Object.entries(state.bindings)) {
    if (!workbook.documents[sheetId]) continue;
    workbook = withSheet(workbook, instantiatePreparedModelFormulas(workbook, sheetId, bindings, previous.documents[sheetId] ?? workbook.documents[sheetId], previousBindings[sheetId] ?? {}));
  }
  return { ...state, workbook };
}

export function bindPreparedSheet(state: PreparedLifecycle, sheetId: string, modelId: string, createColumnId: CreateModelColumnId): Result {
  const { workbook } = state;
  const sheet = workbook.documents[sheetId];
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  const model = workbook.dataModels?.[modelId];
  if (!model) return { ok: false, reason: 'unknown-model' };
  const invalid = validateDataModel(model);
  if (invalid && !invalid.ok) return invalid;
  if (sheet.modelId === modelId) return { ok: true, value: state };
  const materialized = sheet.modelId ? freeze(workbook, sheetId) : sheet;
  const columns = model.columns.map((_, index) => materialized.content.columns[index] ?? createColumnId());
  const structured = withSheet(workbook, reshapeSheet(materialized, model, columns));
  const bindings = { ...state.bindings, [sheetId]: prepareModelFormulas(structured, sheetId) };
  return { ok: true, value: refreshPreparedInstances({ workbook: structured, bindings }, workbook, state.bindings) };
}

export function unbindPreparedSheet(state: PreparedLifecycle, sheetId: string): Result {
  const sheet = state.workbook.documents[sheetId];
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (!sheet.modelId) return { ok: true, value: state };
  const unbound = { ...freeze(state.workbook, sheetId) };
  delete unbound.modelId;
  delete unbound.modelColumnBindings;
  delete unbound.modelFormulaBindings;
  const bindings = { ...state.bindings };
  delete bindings[sheetId];
  return { ok: true, value: refreshPreparedInstances({ workbook: withSheet(state.workbook, unbound), bindings }, state.workbook, state.bindings) };
}

export function replacePreparedDeclaration(state: PreparedLifecycle, model: DataModel, createColumnId: CreateModelColumnId): Result {
  const { workbook } = state;
  const previous = workbook.dataModels?.[model.id];
  if (!previous) return { ok: false, reason: 'unknown-model' };
  const invalid = validateDataModel(model);
  if (invalid && !invalid.ok) return invalid;
  if (JSON.stringify(previous) === JSON.stringify(model)) return { ok: true, value: state };
  const affected = Object.values(workbook.documents).filter((sheet) => sheet.modelId === model.id);
  let next: Workbook = { ...workbook, dataModels: { ...workbook.dataModels, [model.id]: model } };
  for (const sheet of affected) {
    const frozen = freeze(workbook, sheet.id, new Set(model.columns.filter((property) => property.kind === 'manual').map((property) => property.id)));
    const columns = model.columns.map((property) => {
      const retained = sheet.modelColumnBindings?.[property.id];
      return retained && sheet.content.columns.includes(retained) ? retained : createColumnId();
    });
    next = withSheet(next, reshapeSheet(frozen, model, columns));
  }
  const structured = next;
  const bindings = { ...state.bindings };
  for (const sheet of affected) {
    bindings[sheet.id] = Object.fromEntries(model.columns.flatMap((property) => {
      if (property.kind !== 'calculated') return [];
      const old = state.bindings[sheet.id]?.[property.id];
      return [[property.id, old && modelFormulaDeclaration(old) === property.formula ? old : prepareModelFormula(property.formula, structured, sheet.id)]];
    }));
  }
  return { ok: true, value: refreshPreparedInstances({ workbook: next, bindings }, workbook, state.bindings) };
}
