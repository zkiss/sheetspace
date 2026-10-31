import { WorkbookApiError, type WorkbookApi } from './workbookApi';
import type { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';
import { EntryAdmissionRejected } from '@application/core/modelEntrySession';
import type { SheetDocument } from '@workbook/core/model';

export function admitRecordConfirmingMissing(admit: WorkbookApi['admitRecord'], coordinator: WorkbookPersistenceCoordinator, reload: (sheetId: string) => Promise<SheetDocument>, reconcile: (sheet: SheetDocument) => void): WorkbookApi['admitRecord'] {
  return async (sheetId, ...args) => {
    try {
      return await admit(sheetId, ...args);
    } catch (error) {
      if (error instanceof WorkbookApiError && error.status === 404 && error.code === 'sheet-not-found') {
        coordinator.confirmSheetMissing(sheetId);
      }
      if (error instanceof WorkbookApiError && error.status === 400 && error.code === 'invalid-model-record') {
        throw new EntryAdmissionRejected('The record was rejected by validation. Correct the draft and submit again.');
      }
      if (error instanceof WorkbookApiError && error.status === 409 && error.code === 'sheet-revision-conflict') {
        try {
          const sheet = await reload(sheetId);
          coordinator.recordRevision(sheetId, sheet.revision);
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
