import { WorkbookApiError } from './workbookApi';
import { recordReplayErrorMessage } from './recordReplayError';
import type { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';

export async function recoverRecordReplay(error: unknown, coordinator: WorkbookPersistenceCoordinator, refresh: () => Promise<void>): Promise<never> {
  if (error instanceof WorkbookApiError && (error.status === 400 || (error.status === 404 && error.code === 'sheet-not-found') ||
    (error.status === 409 && (error.code === 'sheet-revision-conflict' || error.code === 'model-lifecycle-conflict')))) {
    try { await refresh(); }
    catch { throw new Error(`${recordReplayErrorMessage(error)}. The workbook changed and could not be reloaded. Retry replay to refresh it.`); }
    if (error.status === 404 && error.code === 'sheet-not-found' && error.context?.sheetId) coordinator.confirmSheetMissing(error.context.sheetId);
  }
  throw error;
}
