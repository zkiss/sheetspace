import { WorkbookApiError } from './workbookApi';
import type { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';
import { EntryAdmissionRejected } from '@application/core/modelEntrySession';
import type { SheetDocument } from '@workbook/core/model';

export function admitRecordConfirmingMissing<Args extends unknown[], Result>(admit: (sheetId: string, ...args: Args) => Promise<Result>, coordinator: WorkbookPersistenceCoordinator, reload: (sheetId: string) => Promise<SheetDocument>, reconcile: (sheet: SheetDocument) => void): (sheetId: string, ...args: Args) => Promise<Result> {
  return async (sheetId, ...args) => {
    try {
      return await admit(sheetId, ...args);
    } catch (error) {
      if (error instanceof WorkbookApiError && error.status === 404 && error.code === 'sheet-not-found') {
        coordinator.confirmSheetMissing(error.context?.sheetId ?? sheetId);
      }
      if (error instanceof WorkbookApiError && error.status === 400 && error.code === 'invalid-model-record') {
        throw new EntryAdmissionRejected('The record was rejected by validation. Correct the draft and submit again.');
      }
      if (error instanceof WorkbookApiError && error.status === 409 && error.code === 'sheet-revision-conflict') {
        const conflictingSheetId = error.context?.sheetId ?? sheetId;
        try {
          const sheet = await reload(conflictingSheetId);
          coordinator.recordRevision(conflictingSheetId, sheet.revision);
          reconcile(sheet);
        } catch {
          throw new Error('The sheet changed and could not be reloaded. Retry saving to refresh it.');
        }
        throw new EntryAdmissionRejected('The sheet changed. Review the draft and submit again.');
      }
      throw error;
    }
  };
}
