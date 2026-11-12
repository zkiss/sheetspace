import type { Workbook } from '@workbook/core/model';
import type { FormulaCalculation } from '@calculation/formulaCalculation';
import { deleteRow } from '@application/core/deleteRow';
import { settleSorting } from '@application/core/settleSorting';
import { sheetsInOrder } from '@workbook/read/queries';
import type { useRecordDeletion } from './useRecordDeletion';
import type { LifecyclePublication, TransitionFailure, WorkbookCommands } from './workbookControllerTypes';

export function submitRecordDeletion(options: {
  sheetId: string; rowId: string; publication?: LifecyclePublication;
  before: Workbook; enabled: boolean; capture: ReturnType<typeof useRecordDeletion>;
  local: WorkbookCommands['deleteRow']; blocked: () => boolean;
  calculator: FormulaCalculation; hasUnfinishedEntries: () => boolean;
  validate: (before: Workbook, after: Workbook, protectContents: boolean) => TransitionFailure | undefined;
}): ReturnType<WorkbookCommands['deleteRow']> {
  const { sheetId, rowId, before, capture, publication } = options;
  if (capture.canConfirm(sheetId, rowId)) return { result: { ok: true, value: before }, completion: capture.confirm() };
  const sheet = before.documents[sheetId];
  if (!options.enabled || !sheet?.modelId) return options.local(sheetId, rowId, publication);
  if (options.blocked() || !before.dataModels?.[sheet.modelId]) {
    const result = { ok: false, reason: 'pending-model-transition' } as const;
    return { result, completion: Promise.resolve(result) };
  }
  const result = deleteRow(before, sheetId, rowId);
  if (!result.ok) return { result, completion: Promise.resolve(result) };
  const sorted = sheetsInOrder(before).some((sheet) => sheet.sorting?.length);
  const protectedCandidate = sorted && options.hasUnfinishedEntries()
    ? settleSorting(result.value, options.calculator, { kind: 'structure' }).workbook : result.value;
  const rejection = options.validate(before, protectedCandidate, sorted);
  if (rejection) return { result: rejection, completion: Promise.resolve(rejection) };
  return { result, completion: capture.start(sheetId, rowId, before, publication) };
}
