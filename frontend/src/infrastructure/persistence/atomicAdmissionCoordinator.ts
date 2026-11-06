import type { SheetDocument, Workbook } from '@workbook/core/model';
import type { AtomicRecordAdmission, AtomicRecordAdmissionResult } from './workbookApi';
import type { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';

/** A submission owns its frozen request until the receipt is confirmed or definitively rejected. */
export type AtomicAdmissionSubmission = { request?: AtomicRecordAdmission };

export async function coordinateAtomicAdmission(options: {
  sheetId: string;
  submission: AtomicAdmissionSubmission;
  coordinator: WorkbookPersistenceCoordinator;
  waitForPredecessors: () => Promise<void>;
  currentWorkbook: () => Workbook;
  prepare: (before: Workbook) => AtomicRecordAdmission;
  admit: (sheetId: string, request: AtomicRecordAdmission) => Promise<AtomicRecordAdmissionResult>;
  reconcile: (sheet: SheetDocument) => void;
}): Promise<AtomicRecordAdmissionResult> {
  await options.waitForPredecessors();
  const ids = options.submission.request?.before.manifest.sheetIds ?? options.currentWorkbook().manifest.sheetIds;
  return options.coordinator.serialize(ids, async () => {
    const request = options.submission.request ?? structuredClone(options.prepare(options.currentWorkbook()));
    options.submission.request = request;
    const result = await options.admit(options.sheetId, request);
    if (result.rowId.toLowerCase() !== request.rowId.toLowerCase()) {
      throw new Error('The saved record response did not match the submission. Retry to confirm it.');
    }
    for (const sheet of Object.values(result.workbook.documents)) {
      const known = options.coordinator.revision(sheet.id);
      const current = options.currentWorkbook().documents[sheet.id];
      if (!current || options.coordinator.isSheetMissing(sheet.id) || sheet.revision < Math.max(known ?? 0, current.revision)) continue;
      options.coordinator.recordRevision(sheet.id, sheet.revision);
      options.reconcile(sheet);
    }
    return result;
  });
}
