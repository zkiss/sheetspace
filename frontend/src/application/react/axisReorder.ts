import type { Workbook } from '@workbook/core/model';
import type { SetWorkbook } from '@calculation/workbookCalculation';
import type { ContentHistory } from '@application/core/contentHistory';
import type { ReorderAxis, ReorderResult } from '@workbook/mutations/reorderAxis';
import type { ReorderCommandResult } from './workbookControllerTypes';
import type { useSavedSheetAutosave } from './useSavedSheetAutosave';

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
    const result = transform(options.current.current);
    if (result.status === 'changed') {
      publishOrder(sheetId, axis, result);
      options.history.recordOrder({ sheetId, axis, before: result.before, after: result.after });
      options.setContentHistoryFeedback(undefined);
      options.publishHistory();
    }
    return result;
  }
  return { publishOrder, reorder };
}
