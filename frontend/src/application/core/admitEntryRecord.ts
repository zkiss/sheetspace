import type { Workbook } from '@workbook/core/model';
import type { EntrySubmission } from './modelEntrySession';
import type { RecordAdmissionRequest, RecordAdmissionResult } from './recordAdmission';

type AdmissionCoordinator = {
  serializeWorkbook<T>(request: () => Promise<T>): Promise<T>;
  revision(sheetId: string): number | undefined;
  recordSnapshot(revisions: readonly { sheetId: string; revision: number }[], removed: readonly string[]): unknown;
  confirmSheetMissing(sheetId: string): void;
};

/** The caller holds a workbook mutation fence through drain, capture, dispatch and adoption. */
export async function admitEntryRecord(options: {
  sheetId: string;
  submission: EntrySubmission;
  coordinator: AdmissionCoordinator;
  waitForPredecessors: () => Promise<void>;
  currentWorkbook: () => Workbook;
  loadWorkbook: () => Promise<Workbook>;
  prepare?: (before: Workbook) => RecordAdmissionRequest['rowOrders'];
  admit: (sheetId: string, request: RecordAdmissionRequest) => Promise<RecordAdmissionResult>;
  recover?: (error: unknown, refresh: () => Promise<void>) => Promise<never>;
  reconcile: (workbook: Workbook) => void;
}) {
  const { sheetId, submission, coordinator } = options;
  await options.waitForPredecessors();
  return coordinator.serializeWorkbook(async () => {
    const adopt = (workbook: Workbook) => {
      const current = options.currentWorkbook();
      if (workbook.manifest.revision < current.manifest.revision || Object.values(workbook.documents).some((sheet) =>
        sheet.revision < Math.max(coordinator.revision(sheet.id) ?? 0, current.documents[sheet.id]?.revision ?? 0))) {
        throw new Error('The workbook response is older than a confirmed save. Retry to refresh it.');
      }
      const removed = current.manifest.sheetIds.filter((id) => !workbook.documents[id]);
      coordinator.recordSnapshot(Object.values(workbook.documents).map(({ id, revision }) => ({ sheetId: id, revision })), removed);
      removed.forEach((id) => coordinator.confirmSheetMissing(id));
      options.reconcile(workbook);
    };
    if (!submission.request) {
      const before = await options.loadWorkbook();
      adopt(before);
      const sheet = before.documents[sheetId];
      if (!sheet) throw new Error('The sheet is no longer available.');
      submission.request = structuredClone({ rowId: submission.rowId, values: submission.values, revision: sheet.revision, before, rowOrders: options.prepare?.(before) ?? [] });
    }
    const request = submission.request;
    const result = await options.admit(sheetId, structuredClone(request)).catch((error: unknown) => {
      if (options.recover) return options.recover(error, async () => adopt(await options.loadWorkbook()));
      throw error;
    });
    if (result.rowId.toLowerCase() !== request.rowId.toLowerCase() || typeof result.alreadyCommitted !== 'boolean' ||
      (!result.alreadyCommitted && !result.workbook.documents[sheetId]?.content.rows.includes(result.rowId))) {
      throw new Error('The saved record response did not match the submission. Retry to confirm it.');
    }
    adopt(result.workbook);
    return { rowId: result.rowId, sheet: result.workbook.documents[sheetId] };
  });
}
