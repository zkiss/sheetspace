import type { Workbook } from '@workbook/core/model';
import { sheetsInOrder } from '@workbook/read/queries';
import type { FormulaCalculation } from '@calculation/formulaCalculation';
import type { ContentHistory } from '@application/core/contentHistory';
import type { LifecyclePublication, TransitionFailure } from './workbookControllerTypes';
import { submitSortedOrigin } from './submitSortedOrigin';
import type { WorkbookOperationResult } from '@application/core/userActions';

export function submitSortedDeletion(before: Workbook, result: WorkbookOperationResult, submit: (candidate: Workbook) => { ok: true; value: Workbook } | TransitionFailure | { ok: false; reason: 'sorting-history-too-large' }): WorkbookOperationResult | undefined {
  if (!result.ok || !result.value.changed || !(sheetsInOrder(before).some((sheet) => sheet.sorting?.length) || sheetsInOrder(result.value.nextWorkbook).some((sheet) => sheet.sorting?.length))) return undefined;
  const submitted = submit(result.value.nextWorkbook);
  if (!submitted.ok) return submitted;
  return { ok: true, value: { ...result.value, nextWorkbook: submitted.value, calculationImpact: { kind: 'structure' } } };
}

export function submitOriginatingLifecycle<T extends { ok: true; value: Workbook } | { ok: false }>(options: {
  before: Workbook;
  transform: (source: Workbook) => T;
  publication?: LifecyclePublication;
  replayUnresolved: boolean;
  calculation: FormulaCalculation;
  history: ContentHistory;
  submit: <R extends { ok: true; value: Workbook } | { ok: false }>(transform: (source: Workbook) => R, success?: (before: Workbook, after: Workbook) => void, protect?: boolean, publication?: LifecyclePublication) => { result: R | TransitionFailure; completion: Promise<R | TransitionFailure> };
  publish: () => void;
}) {
  const candidate = options.transform(options.before);
  if (!candidate.ok || candidate.value === options.before || !(sheetsInOrder(options.before).some((sheet) => sheet.sorting?.length) || sheetsInOrder(candidate.value).some((sheet) => sheet.sorting?.length))) {
    return options.submit(() => candidate, undefined, false, options.publication);
  }
  if (options.replayUnresolved) {
    const rejected = { ok: false, reason: 'pending-model-transition' } as const;
    return { result: rejected, completion: Promise.resolve(rejected) };
  }
  let completion: Promise<{ ok: true; value: Workbook } | TransitionFailure> | undefined;
  const result = submitSortedOrigin({ before: options.before, candidate: candidate.value, impact: { kind: 'structure' }, calculation: options.calculation, history: options.history,
    submit: (final, success) => {
      const submission = options.submit(() => ({ ok: true as const, value: final }), success, true, options.publication);
      completion = submission.completion;
      return submission;
    }, publish: options.publish,
  });
  return { result, completion: completion ?? Promise.resolve(result) };
}
