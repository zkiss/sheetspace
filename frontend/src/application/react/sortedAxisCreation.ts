import type { Workbook } from '@workbook/core/model';
import { appendColumn, appendRow } from '@workbook/mutations/operations';
import { findSheetById, sheetsInOrder } from '@workbook/read/queries';
import type { FormulaCalculation } from '@calculation/formulaCalculation';
import type { ContentHistory } from '@application/core/contentHistory';
import type { LifecyclePublication, TransitionFailure } from './workbookControllerTypes';
import { submitOriginatingLifecycle } from './submitOriginatingLifecycle';

export function createSortedAxis(options: {
  entry: { operationId: string; sheetId: string; axis: 'row' | 'column' };
  before: Workbook;
  replayUnresolved: boolean;
  calculation: FormulaCalculation;
  history: ContentHistory;
  submit: <R extends { ok: true; value: Workbook } | { ok: false }>(transform: (source: Workbook) => R, success?: (before: Workbook, after: Workbook) => void, protect?: boolean, publication?: LifecyclePublication) => { result: R | TransitionFailure; completion: Promise<R | TransitionFailure> };
  publish: () => void;
}): boolean | Promise<boolean> {
  const { before, entry } = options;
  const sheet = findSheetById(before, entry.sheetId);
  if (!sheet || sheet.modelId) return true;
  if (!sheetsInOrder(before).some((item) => item.sorting?.length)) return false;
  const id = crypto.randomUUID();
  const updated = entry.axis === 'row' ? appendRow(sheet, id) : appendColumn(sheet, id);
  const candidate = { ...before, documents: { ...before.documents, [sheet.id]: updated } };
  const submission = submitOriginatingLifecycle({ ...options, transform: () => ({ ok: true as const, value: candidate }) });
  return submission.completion.then((result) => {
    if (!result.ok) throw new Error('Sorted axis creation failed');
    return true;
  });
}
