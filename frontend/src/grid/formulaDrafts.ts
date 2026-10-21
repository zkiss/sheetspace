import type { FormulaDraftSession, FormulaEditTarget, ModelPropertyTarget } from './cellInteractionContracts';

export function formulaDraftKey(target: FormulaEditTarget) {
  // A JSON tuple keeps the target kind and every stable ID as distinct values.
  // Delimiters are valid in IDs, so joining strings would let distinct targets
  // share a draft slot.
  return 'sheetId' in target
    ? JSON.stringify(['cell', target.sheetId, target.cell.rowId, target.cell.columnId])
    : JSON.stringify(['model-property', target.modelId, target.propertyId]);
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
