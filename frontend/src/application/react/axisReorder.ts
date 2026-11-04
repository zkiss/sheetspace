import type { Workbook } from '@workbook/core/model';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import type { ContentHistory } from '@application/core/contentHistory';
import type { ReorderAxis, ReorderResult } from '@workbook/mutations/reorderAxis';
import type { ReorderCommandResult } from './workbookControllerTypes';
import type { useSavedSheetAutosave } from './useSavedSheetAutosave';
import { applyAxisPermutation } from '@workbook/mutations/reorderAxis';

type Options = {
  current: { current: Workbook };
  setWorkbook: SetWorkbook;
  history: ContentHistory;
  enqueue: ReturnType<typeof useSavedSheetAutosave>['enqueue'];
  hasPending: () => boolean;
  admissionLocks: { current: Set<string> };
  setMutationFailure: (failure: 'pending-model-transition' | undefined) => void;
  setContentHistoryFeedback: (feedback: undefined) => void;
  publishHistory: () => void;
  clearOtherFailures?: () => void;
  setReplayFailure: (failure: 'pending-model-transition' | 'order-conflict' | undefined) => void;
};

export function createAxisReorder(options: Options) {
  function publishOrder(sheetId: string, axis: ReorderAxis, result: Extract<ReorderResult, { status: 'changed' }>) {
    options.current.current = result.workbook;
    options.setWorkbook(result.workbook, { kind: 'structure' });
    options.enqueue(crypto.randomUUID(), { kind: 'write-axis-order', sheetId, axis, before: result.before, after: result.after });
  }

  function reorder(sheetId: string, axis: ReorderAxis, transform: (workbook: Workbook) => ReorderResult): ReorderCommandResult {
    if (options.hasPending() || options.admissionLocks.current.has(sheetId)) {
      options.setMutationFailure('pending-model-transition');
      return { status: 'rejected', workbook: options.current.current, reason: 'pending-model-transition' };
    }
    options.setMutationFailure(undefined);
    const result = transform(options.current.current);
    if (result.status === 'changed') {
      const admitted = options.history.recordOrder({ sheetId, axis, before: result.before, after: result.after });
      if (!admitted.ok) return { status: 'rejected', workbook: options.current.current, reason: admitted.reason };
      options.setReplayFailure(undefined);
      options.clearOtherFailures?.();
      publishOrder(sheetId, axis, result);
      options.setContentHistoryFeedback(undefined);
      options.publishHistory();
    }
    return result;
  }
  function replay(order: NonNullable<import('@application/core/contentHistory').ContentTransaction['order']>, direction: 'undo' | 'redo') {
    const { sheetId, axis, before, after } = order;
    options.setReplayFailure(undefined);
    if (options.hasPending() || options.admissionLocks.current.has(sheetId)) {
      options.setReplayFailure('pending-model-transition');
      return;
    }
    const sheet = options.current.current.documents[sheetId];
    const current = axis === 'row' ? sheet?.content.rows : sheet?.content.columns;
    const expected = direction === 'undo' ? after : before;
    if (!current || current.length !== expected.length || current.some((id, index) => id !== expected[index])) {
      options.setReplayFailure('order-conflict');
      return;
    }
    const result = applyAxisPermutation(options.current.current, sheetId, axis, direction === 'undo' ? before : after);
    if (result.status !== 'changed') { options.setReplayFailure('order-conflict'); return; }
    options.clearOtherFailures?.();
    publishOrder(sheetId, axis, result);
    if (direction === 'undo') options.history.commitUndo(); else options.history.commitRedo();
    options.setContentHistoryFeedback(undefined);
    options.publishHistory();
  }
  return { reorder, replay };
}
