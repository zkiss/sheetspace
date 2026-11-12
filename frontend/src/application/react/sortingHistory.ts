import type { SortCriterion, Workbook } from '@workbook/core/model';
import type { FormulaCalculation } from '@calculation/formulaCalculation';
import { configureSorting } from '@application/core/configureSorting';
import { replayDelta, semantic } from '@application/core/extractionHistory';
import type { ContentHistory, ContentTransaction } from '@application/core/contentHistory';
import type { SortingResult, SortingSubmission } from './workbookControllerTypes';

type Candidate = { ok: true; value: Workbook; changed: boolean } | { ok: false; reason: 'invalid-sorting' | 'sorting-history-too-large' | 'stale-history' };
type Submission = { result: Candidate | import('./workbookControllerTypes').TransitionFailure; completion: Promise<Candidate | import('./workbookControllerTypes').TransitionFailure> };

export function createSortingHistory(options: {
  submit: (transform: (source: Workbook) => Candidate, success: (before: Workbook, after: Workbook) => void) => Submission;
  history: ContentHistory;
  calculation: FormulaCalculation;
  publish: () => void;
}) {
  function replay(transaction: ContentTransaction, direction: 'undo' | 'redo') {
    if (!transaction.snapshots) return;
    const { before, after } = transaction.snapshots;
    const expected = direction === 'undo' ? after : before;
    const target = direction === 'undo' ? before : after;
    options.submit((current) => {
      const delta = replayDelta(semantic(current), semantic(expected), semantic(target));
      if (!delta.ok) return { ok: false, reason: 'stale-history' };
      const next = delta.value as Workbook;
      next.manifest.revision = current.manifest.revision;
      for (const [id, sheet] of Object.entries(next.documents)) sheet.revision = current.documents[id]?.revision ?? 0;
      return { ok: true, value: next, changed: true };
    }, () => {
      if (options.history.commitGuarded(direction, transaction.identity)) options.publish();
    });
  }
  function configure(sheetId: string, criteria: readonly SortCriterion[]): SortingSubmission {
    const submission = options.submit((source) => {
      const configured = configureSorting(source, sheetId, criteria, options.calculation);
      if (configured.status === 'rejected') return { ok: false, reason: 'invalid-sorting' };
      if (configured.status === 'unchanged') return { ok: true, value: source, changed: false };
      if (!options.history.canRecordSemantic(source, configured.workbook)) return { ok: false, reason: 'sorting-history-too-large' };
      return { ok: true, value: configured.workbook, changed: true };
    }, (before, after) => {
      options.history.recordSemantic(before, after);
      options.publish();
    });
    return submission as { result: SortingResult; completion: Promise<SortingResult> };
  }
  return { replay, configure };
}
