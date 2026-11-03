import { useState } from 'react';
import type { Workbook } from '@workbook/core/model';
import type { ContentHistory, ContentTransaction } from '@application/core/contentHistory';
import { prepareExtractionReplay, type ExtractionReplayResult } from '@application/core/extractionHistory';
import type { ExtractionReplayFailure, TransitionFailure } from './workbookControllerTypes';

type ReplayResult = { ok: true; value: Workbook } | Extract<ExtractionReplayResult, { ok: false }> | TransitionFailure;

export function useExtractionReplay(options: {
  history: ContentHistory;
  hasPending: () => boolean;
  clearFeedback: () => void;
  publishHistory: () => void;
  submit: (transform: (current: Workbook) => ReplayResult, success: () => void) => { result: ReplayResult; completion: Promise<ReplayResult> };
}) {
  const [failure, setFailure] = useState<ExtractionReplayFailure>();
  function replay(transaction: ContentTransaction, direction: 'undo' | 'redo') {
    options.clearFeedback();
    setFailure(undefined);
    if (options.hasPending()) {
      setFailure('pending-model-transition');
      return;
    }
    const submission = options.submit((current) => {
      const prepared = prepareExtractionReplay(current, transaction, direction);
      return prepared.ok ? { ok: true, value: prepared.workbook } : prepared;
    }, () => {
      setFailure(undefined);
      if (direction === 'undo') options.history.commitUndo(); else options.history.commitRedo();
      options.publishHistory();
    });
    if (!submission.result.ok) setFailure(submission.result.reason);
    else void submission.completion.then((result) => {
      if (!result.ok) setFailure(result.reason);
    });
  }
  return { failure, clearFailure: () => setFailure(undefined), replay };
}
