import { useState } from 'react';
import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { replayCellPersistenceWrites, type AppliedWorkbookOperation, type WorkbookOperationResult } from '@application/core/userActions';
import { createAxisReorder } from './axisReorder';
import { useExtractionReplay } from './useExtractionReplay';
import { contentHistoryAffectedSnapshot, contentHistorySnapshot } from './workbookControllerTypes';
import type { WorkbookController } from './workbookControllerTypes';

type AxisOptions = Parameters<typeof createAxisReorder>[0];
type ExtractionOptions = Parameters<typeof useExtractionReplay>[0];

export function useMixedHistory(options: Omit<AxisOptions, 'setReplayFailure' | 'clearOtherFailures'> & {
  submit: ExtractionOptions['submit'];
  applyResult: (result: WorkbookOperationResult) => AppliedWorkbookOperation | undefined;
  formulaResults: FormulaEvaluationSnapshot;
  setCellFeedback: (feedback: WorkbookController['contentHistoryFeedback']) => void;
}) {
  const [orderFailure, setOrderFailure] = useState<WorkbookController['orderReplayFailure']>();
  const extraction = useExtractionReplay({
    history: options.history, hasPending: options.hasPending, submit: options.submit,
    clearFeedback: () => options.setCellFeedback(undefined), publishHistory: options.publishHistory,
    clearOtherFailures: () => setOrderFailure(undefined),
  });
  function clearFailures() {
    setOrderFailure(undefined);
    extraction.clearFailure();
  }
  function clearFeedback() {
    clearFailures();
    options.setCellFeedback(undefined);
  }
  const axis = createAxisReorder({ ...options, setReplayFailure: setOrderFailure, clearOtherFailures: extraction.clearFailure });
  function replay(direction: 'undo' | 'redo') {
    const transaction = direction === 'undo' ? options.history.peekUndo() : options.history.peekRedo();
    if (!transaction) return;
    if (transaction.kind === 'model-record') return;
    if (transaction.kind === 'extraction') return extraction.replay(transaction, direction);
    if (transaction.kind === 'axis-order' && transaction.order) return axis.replay(transaction.order, direction);
    if (options.hasPending()) return;
    if (transaction.writes.some((write) => options.admissionLocks.current.has(write.sheetId))) {
      options.setMutationFailure('pending-model-transition');
      return;
    }
    const source = options.current.current;
    const applied = options.applyResult(replayCellPersistenceWrites(source, transaction.writes, direction === 'undo' ? 'after' : 'before'));
    if (!applied?.changed || applied.persistence?.kind !== 'write-cells') return;
    const operationId = crypto.randomUUID();
    options.enqueue(operationId, applied.persistence);
    if (direction === 'undo') options.history.commitUndo(); else options.history.commitRedo();
    clearFailures();
    options.setCellFeedback(Object.freeze({
      identity: operationId,
      affected: contentHistoryAffectedSnapshot(applied.affected),
      before: contentHistorySnapshot(applied.persistence.writes, 'beforeRaw', source, options.formulaResults),
      after: contentHistorySnapshot(applied.persistence.writes, 'afterRaw'),
    }));
    options.publishHistory();
  }
  return { replay, reorder: axis.reorder, clearFeedback, orderFailure, extractionFailure: extraction.failure };
}
