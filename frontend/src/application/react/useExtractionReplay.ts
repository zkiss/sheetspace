import { useState } from 'react';
import type { Workbook } from '@workbook/core/model';
import type { ContentHistory, ContentTransaction } from '@application/core/contentHistory';
import { prepareExtractionReplay, type ExtractionReplayResult } from '@application/core/extractionHistory';
import type { ExtractionReplayFailure, TransitionFailure } from './workbookControllerTypes';

type ReplayResult = { ok: true; value: Workbook } | Extract<ExtractionReplayResult, { ok: false }> | TransitionFailure;

export function useExtractionReplay(options: {
  history: ContentHistory;
  current: () => Workbook;
  requireAuthority: boolean;
  hasPending: () => boolean;
  clearFeedback: () => void;
  publishHistory: () => void;
  clearOtherFailures?: () => void;
  submit: (transform: (current: Workbook) => ReplayResult, success: () => void, replay?: { transitionId: string; direction: 'undo' | 'redo' }) => { result: ReplayResult; completion: Promise<ReplayResult> };
}) {
  const [failure, setFailure] = useState<ExtractionReplayFailure>();
  function replay(transaction: ContentTransaction, direction: 'undo' | 'redo') {
    options.clearFeedback();
    setFailure(undefined);
    if (options.hasPending()) {
      setFailure('pending-model-transition');
      return;
    }
    const prepared = prepareExtractionReplay(options.current(), transaction, direction, options.requireAuthority);
    if (!prepared.ok) { setFailure(prepared.reason); return; }
    const replay = prepared.persistence.kind === 'model-lifecycle' ? prepared.persistence.replay : undefined;
    const submission = options.submit(() => ({ ok: true, value: prepared.workbook }), () => {
      setFailure(undefined);
      options.clearOtherFailures?.();
      if (options.history.commitGuarded(direction, transaction.identity)) options.publishHistory();
    }, replay);
    if (!submission.result.ok) setFailure(submission.result.reason);
    else void submission.completion.then((result) => {
      if (!result.ok) setFailure(result.reason);
    });
  }
  return { failure, clearFailure: () => setFailure(undefined), replay };
}
