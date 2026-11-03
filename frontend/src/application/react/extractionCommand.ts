import type { Workbook } from '@workbook/core/model';
import type { ContentHistory } from '@application/core/contentHistory';
import { extractSelection } from '@application/core/extractSelection';
import type { ExtractionRequest } from '@application/core/extractionPreparation';
import type { ExtractionCommandResult, ExtractionSubmission, TransitionFailure } from './workbookControllerTypes';

type Prepared = { ok: true; value: Workbook } | Extract<ExtractionCommandResult, { ok: false }>;

export function extractionCommand(request: ExtractionRequest, options: {
  history: ContentHistory;
  publish: () => void;
  submit: (transform: (before: Workbook) => Prepared, success: (before: Workbook, after: Workbook) => void) => { result: Prepared | TransitionFailure; completion: Promise<Prepared | TransitionFailure> };
}): ExtractionSubmission {
  let extracted: ReturnType<typeof extractSelection> | undefined;
  const submission = options.submit((before) => {
    extracted = extractSelection(before, request);
    if (!extracted.ok) return extracted;
    if (!options.history.canRecordExtraction(before, extracted.workbook)) return { ok: false, reason: 'extraction-history-too-large' };
    return { ok: true, value: extracted.workbook };
  }, (before, after) => {
    options.history.recordExtraction(before, after);
    options.publish();
  });
  const convert = (result: typeof submission.result): ExtractionCommandResult => result.ok ? extracted! : result;
  return { result: convert(submission.result), completion: submission.completion.then(convert) };
}
