import type { FormulaDraftSession, FormulaEditTarget, ModelPropertyTarget } from './cellInteractionContracts';

export function formulaDraftKey(target: FormulaEditTarget) {
  return 'sheetId' in target
    ? `${target.sheetId}:${target.cell.rowId}:${target.cell.columnId}`
    : `property:${target.modelId}:${target.propertyId}`;
}

export function modelPropertyDraftKey(target: ModelPropertyTarget) {
  return formulaDraftKey(target);
}

export function draftForTarget(
  drafts: Readonly<Record<string, FormulaDraftSession>>,
  target: FormulaEditTarget,
) {
  return drafts[formulaDraftKey(target)];
}
