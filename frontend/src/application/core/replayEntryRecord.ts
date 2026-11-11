import type { Workbook } from '@workbook/core/model';
import type { RecordReplayRequest, RecordReplayResult } from './recordReplay';

export type ReplayOperation = {
  sheetId: string;
  rowId: string;
  operationId: string;
  direction: 'undo' | 'redo';
};

type ReplayState = {
  identity: Pick<ReplayOperation, 'sheetId' | 'rowId' | 'operationId' | 'direction'>;
  request?: RecordReplayRequest;
  pending: boolean;
  retired: boolean;
};
const states = new WeakMap<ReplayOperation, ReplayState>();

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
  let state = states.get(operation);
  if (!state) {
    state = { identity: structuredClone(operation), pending: false, retired: false };
    states.set(operation, state);
  }
  if (state.pending) throw new Error('Record replay is already pending.');
  if (state.retired) throw new Error('Record replay operation has already settled.');
  const release = coordinator.beginRecordReplay();
  state.pending = true;
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
      if (!state.request) {
        const before = await options.loadWorkbook();
        adopt(before);
        state.request = structuredClone({ operationId: state.identity.operationId, direction: state.identity.direction, before });
      }
      const request = state.request;
      const path = state.identity;
      const result = await options.replay(path.sheetId, path.rowId, structuredClone(request)).catch((error: unknown) => {
        if (options.recover) return options.recover(error, async () => {
          adopt(await options.loadWorkbook());
          state.retired = true;
        });
        throw error;
      });
      if (result.operationId.toLowerCase() !== request.operationId.toLowerCase() || result.rowId.toLowerCase() !== path.rowId.toLowerCase() || typeof result.alreadyCommitted !== 'boolean') {
        throw new Error('The replay response did not match the operation. Retry to confirm it.');
      }
      adopt(result.workbook);
      state.retired = true;
      return result;
    });
  } finally {
    state.pending = false;
    release();
  }
}
