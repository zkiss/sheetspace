import { FormulaCalculation } from '@calculation/formulaCalculation';
import type { Workbook } from '@workbook/core/model';
import { instantiatePreparedModelFormulas, prepareModelFormula, prepareModelFormulas, type PreparedModelFormula } from '@workbook/formula/preparedModelTemplate';
import { projectRenamedBindings, type ModelFormulaEditPlan } from '@workbook/formula/renamedModelFormulas';
import { renameOrdinaryColumn } from '@workbook/mutations/renameOrdinaryColumn';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { lifecycleOperations, withSheet } from './modelLifecycle';

type Bindings = Readonly<Record<string, PreparedModelFormula>>;
export type PreparedLifecycle = { workbook: Workbook; bindings: Readonly<Record<string, Bindings>> };
function renamePreparedBindings(state: PreparedLifecycle, workbook: Workbook, plans: ModelFormulaEditPlan): PreparedLifecycle {
  let bindings = state.bindings;
  for (const [sheetId, current] of Object.entries(state.bindings)) {
    const modelId = workbook.documents[sheetId]?.modelId;
    const updated = projectRenamedBindings(current, modelId ? plans[modelId] : undefined);
    if (updated !== current) bindings = { ...bindings, [sheetId]: updated };
  }
  return { ...state, workbook, bindings };
}

export function renamePreparedOrdinaryColumn(state: PreparedLifecycle, sheetId: string, columnId: string, name: string) {
  let plans: ModelFormulaEditPlan = {};
  const result = renameOrdinaryColumn(state.workbook, sheetId, columnId, name, (value) => { plans = value; });
  if (!result.ok) return result;
  return { ok: true as const, value: renamePreparedBindings(state, result.value, plans) };
}
export function refreshPreparedInstances(state: PreparedLifecycle, previous: Workbook = state.workbook, previousBindings = state.bindings): PreparedLifecycle {
  let workbook = state.workbook;
  for (const [sheetId, bindings] of Object.entries(state.bindings)) {
    if (!workbook.documents[sheetId]) continue;
    workbook = withSheet(workbook, instantiatePreparedModelFormulas(workbook, sheetId, bindings, previous.documents[sheetId] ?? workbook.documents[sheetId], previousBindings[sheetId] ?? {}));
  }
  return { ...state, workbook };
}

const preparedLifecycle = lifecycleOperations<PreparedLifecycle, PreparedModelFormula>({
  workbook: (state) => state.workbook,
  source: (state) => state,
  bindings: (state, sheetId) => state.bindings[sheetId] ?? {},
  prepare: (workbook, sheetId, formula) => prepareModelFormula(formula, workbook, sheetId),
  prepareAll: prepareModelFormulas,
  calculate: (workbook) => new FormulaCalculation().updateStored(calculationProjection(workbook), workbook, { kind: 'structure' }),
  rename: renamePreparedBindings,
  finish: (state, workbook, changes) => {
    const bindings = { ...state.bindings };
    for (const [sheetId, value] of Object.entries(changes)) {
      if (value) bindings[sheetId] = value;
      else delete bindings[sheetId];
    }
    return refreshPreparedInstances({ workbook, bindings }, state.workbook, state.bindings);
  },
});

export const bindPreparedSheet = preparedLifecycle.bind;
export const unbindPreparedSheet = preparedLifecycle.unbind;
export const replacePreparedDeclaration = preparedLifecycle.replace;
