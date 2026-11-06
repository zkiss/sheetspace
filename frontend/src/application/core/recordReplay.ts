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
