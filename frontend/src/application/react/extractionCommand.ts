import type { Workbook } from '@workbook/core/model';
import type { ContentHistory } from '@application/core/contentHistory';
import { extractSelection } from '@application/core/extractSelection';
import type { ExtractionRequest } from '@application/core/extractionPreparation';
import type { ExtractionCommandResult, ExtractionSubmission, TransitionFailure } from './workbookControllerTypes';
import { sheetsInOrder } from '@workbook/read/queries';

type Prepared = { ok: true; value: Workbook } | Extract<ExtractionCommandResult, { ok: false }>;

export function extractionCommand(request: ExtractionRequest, options: {
  history: ContentHistory;
  requireAuthority: boolean;
  current: () => Workbook;
  publish: () => void;
  submit: (transform: (before: Workbook) => Prepared, success: (before: Workbook, after: Workbook, receipt?: import('@infrastructure/persistence/workbookApi').LifecycleReceipt) => void) => { result: Prepared | TransitionFailure; completion: Promise<Prepared | TransitionFailure> };
  settleSorted: (before: Workbook, candidate: Workbook) => Workbook;
}): ExtractionSubmission {
  let extracted: ReturnType<typeof extractSelection> | undefined;
  let recordPrepared: ((transitionId?: string) => void) | undefined;
  const submission = options.submit((before) => {
    extracted = extractSelection(before, request);
    if (!extracted.ok) return extracted;
    const candidate = sheetsInOrder(before).some((sheet) => sheet.sorting?.length) || sheetsInOrder(extracted.workbook).some((sheet) => sheet.sorting?.length)
      ? options.settleSorted(before, extracted.workbook) : extracted.workbook;
    recordPrepared = options.history.prepareExtraction(before, candidate, options.requireAuthority);
    if (!recordPrepared) return { ok: false, reason: 'extraction-history-too-large' };
    return { ok: true, value: candidate };
  }, (_before, _after, receipt) => {
    recordPrepared?.(receipt?.transitionId);
    options.publish();
  });
  const convert = (result: typeof submission.result): ExtractionCommandResult => result.ok && extracted?.ok ? { ...extracted, workbook: result.value } : result.ok ? extracted! : result;
  return { result: convert(submission.result), completion: submission.completion.then(convert) };
}
