import type { SheetDocument } from '@workbook/core/model';
import type { EntrySubmission } from './modelEntrySession';

type AdmissionCoordinator = {
  serialize<T>(sheetIds: readonly string[], request: () => Promise<T>): Promise<T>;
  revision(sheetId: string): number | undefined;
  recordRevision(sheetId: string, revision: number): number;
  isSheetMissing(sheetId: string): boolean;
};

/** Drain queued predecessors before reserving the sheet, then retain the first dispatched revision. */
export async function admitEntryRecord(options: {
  sheetId: string;
  submission: EntrySubmission;
  coordinator: AdmissionCoordinator;
  waitForPredecessors: () => Promise<void>;
  currentSheet: () => SheetDocument | undefined;
  admit: (sheetId: string, rowId: string, values: Readonly<Record<string, string>>, revision: number) => Promise<{ rowId: string; sheet: SheetDocument }>;
  reconcile: (sheet: SheetDocument) => void;
}) {
  const { sheetId, submission, coordinator } = options;
  await options.waitForPredecessors();
  return coordinator.serialize([sheetId], async () => {
    const sheet = options.currentSheet();
    if (!sheet || coordinator.isSheetMissing(sheetId)) throw new Error('The sheet is no longer available.');
    submission.revision ??= coordinator.revision(sheetId) ?? sheet.revision;
    const result = await options.admit(sheetId, submission.rowId, submission.values, submission.revision);
    if (result.rowId.toLowerCase() !== submission.rowId.toLowerCase() || result.sheet.id !== sheetId) {
      throw new Error('The saved record response did not match the submission. Retry to confirm it.');
    }
    if (!options.currentSheet() || coordinator.isSheetMissing(sheetId)) throw new Error('The sheet is no longer available.');
    coordinator.recordRevision(sheetId, result.sheet.revision);
    options.reconcile(result.sheet);
    return result;
  });
}
