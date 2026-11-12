import type { Workbook } from '@workbook/core/model';
import type { ModelEntrySessions } from '@application/core/modelEntrySession';
import type { TransitionFailure } from './workbookControllerTypes';

export function modelTransitionRejection(options: {
  before: Workbook; after: Workbook; protectEntryContents: boolean;
  admissionLocks: ReadonlySet<string>; entrySessions: ModelEntrySessions;
  axisPending: boolean; sheetPending: boolean; lifecyclePending: boolean; failedPrerequisite: boolean;
}): TransitionFailure | undefined {
  const { before, after } = options;
  if (Object.keys(before.documents).some((id) =>
    (options.admissionLocks.has(id) && before.documents[id] !== after.documents[id]) ||
    (options.protectEntryContents && options.entrySessions.hasUnfinished(id) && JSON.stringify({ ...before.documents[id], revision: 0 }) !== JSON.stringify({ ...after.documents[id], revision: 0 })) ||
    options.entrySessions.protectsTransition(before, after, id))) {
    return { ok: false, reason: 'pending-model-transition' };
  }
  if (options.axisPending) return { ok: false, reason: 'pending-axis-creation' };
  if (options.sheetPending) return { ok: false, reason: 'pending-sheet-creation' };
  if (options.lifecyclePending) return { ok: false, reason: 'pending-model-transition' };
  if (options.failedPrerequisite) return { ok: false, reason: 'blocked-persistence-prerequisite' };
}
