import type { Workbook } from '@workbook/core/model';
import type { RecordReplayRequest, RecordReplayResult } from './recordReplay';

export type ReplayOperation = {
  sheetId: string;
  rowId: string;
  operationId: string;
  direction: 'undo' | 'redo';
  request?: RecordReplayRequest;
  path?: { sheetId: string; rowId: string };
  pending?: boolean;
};

type ReplayCoordinator = {
  beginRecordReplay(): () => void;
  serializeWorkbook<T>(request: () => Promise<T>): Promise<T>;
  revision(sheetId: string): number | undefined;
  recordSnapshot(revisions: readonly { sheetId: string; revision: number }[], removed: readonly string[]): unknown;
  confirmSheetMissing(sheetId: string): void;
};

/** The caller must fence local workbook mutations until this operation settles. */
export async function replayEntryRecord(options: {
  operation: ReplayOperation;
  coordinator: ReplayCoordinator;
  waitForPredecessors: () => Promise<void>;
  currentWorkbook: () => Workbook;
  loadWorkbook: () => Promise<Workbook>;
  replay: (sheetId: string, rowId: string, request: RecordReplayRequest) => Promise<RecordReplayResult>;
  reconcile: (workbook: Workbook) => void;
  recover?: (error: unknown, refresh: () => Promise<void>) => Promise<never>;
}) {
  const { operation, coordinator } = options;
  if (operation.pending) throw new Error('Record replay is already pending.');
  const release = coordinator.beginRecordReplay();
  operation.pending = true;
  try {
    await options.waitForPredecessors();
    return await coordinator.serializeWorkbook(async () => {
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
      if (!operation.request) {
        const before = await options.loadWorkbook();
        adopt(before);
        operation.request = structuredClone({ operationId: operation.operationId, direction: operation.direction, before });
        operation.path = { sheetId: operation.sheetId, rowId: operation.rowId };
      }
      const request = operation.request;
      const path = operation.path!;
      const result = await options.replay(path.sheetId, path.rowId, structuredClone(request)).catch((error: unknown) => {
        if (options.recover) return options.recover(error, async () => adopt(await options.loadWorkbook()));
        throw error;
      });
      if (result.operationId.toLowerCase() !== request.operationId.toLowerCase() || result.rowId.toLowerCase() !== path.rowId.toLowerCase() || typeof result.alreadyCommitted !== 'boolean') {
        throw new Error('The replay response did not match the operation. Retry to confirm it.');
      }
      adopt(result.workbook);
      return result;
    });
  } finally {
    operation.pending = false;
    release();
  }
}
