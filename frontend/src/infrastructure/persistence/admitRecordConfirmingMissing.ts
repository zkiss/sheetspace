import { WorkbookApiError, type WorkbookApi } from './workbookApi';
import type { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';

export function admitRecordConfirmingMissing(admit: WorkbookApi['admitRecord'], coordinator: WorkbookPersistenceCoordinator): WorkbookApi['admitRecord'] {
  return async (sheetId, ...args) => {
    try {
      return await admit(sheetId, ...args);
    } catch (error) {
      if (error instanceof WorkbookApiError && error.status === 404 && error.code === 'sheet-not-found') {
        coordinator.confirmSheetMissing(sheetId);
      }
      throw error;
    }
  };
}
