import { WorkbookApiError } from './workbookApi';

export function recordReplayErrorMessage(error: unknown): string {
  if (!(error instanceof WorkbookApiError)) return error instanceof Error ? error.message : 'Record replay failed.';
  const context = error.context;
  const details = [
    context?.sheetId === undefined ? undefined : `sheet ${context.sheetId}`,
    context?.scope === undefined ? undefined : `scope ${context.scope}`,
    context?.expectedRevision === undefined ? undefined : `expected revision ${context.expectedRevision}`,
    context?.actualRevision === undefined ? undefined : `actual revision ${context.actualRevision}`,
  ].filter((detail) => detail !== undefined);
  return details.length ? `${error.message} (${details.join(', ')})` : error.message;
}
