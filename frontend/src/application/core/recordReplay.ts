import type { Workbook } from '@workbook/core/model';

export type RecordReplayRequest = {
  operationId: string;
  direction: 'undo' | 'redo';
  before: Workbook;
};

export type RecordReplayResult = {
  operationId: string;
  rowId: string;
  alreadyCommitted: boolean;
  workbook: Workbook;
};

export type RecordDeletionRequest = {
  operationId: string;
  before: Workbook;
  rowOrders: readonly { sheetId: string; order: readonly string[] }[];
};

export type RecordDeletionResult = RecordReplayResult & { deletionId: string };
