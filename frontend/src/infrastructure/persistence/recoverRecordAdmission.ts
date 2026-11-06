import { WorkbookApiError } from './workbookApi';
import type { WorkbookPersistenceCoordinator } from './workbookPersistenceCoordinator';
import { EntryAdmissionRejected } from '@application/core/modelEntrySession';

/** Recovery runs inside the admission fence and full-workbook transport reservation. */
export async function recoverRecordAdmission(error: unknown, sheetId: string, coordinator: WorkbookPersistenceCoordinator, refresh: () => Promise<void>): Promise<never> {
  if (error instanceof WorkbookApiError) {
    if (error.status === 404 && error.code === 'sheet-not-found') {
      coordinator.confirmSheetMissing(error.context?.sheetId ?? sheetId);
    }
    if (error.status === 400 && error.code === 'invalid-model-record') {
      throw new EntryAdmissionRejected('The record was rejected by validation. Correct the draft and submit again.');
    }
    if (error.status === 409 && (error.code === 'sheet-revision-conflict' || error.code === 'model-lifecycle-conflict')) {
      try { await refresh(); }
      catch { throw new Error('The workbook changed and could not be reloaded. Retry saving to refresh it.'); }
      throw new EntryAdmissionRejected('The workbook changed. Review the draft and submit again.');
    }
  }
  throw error;
}
