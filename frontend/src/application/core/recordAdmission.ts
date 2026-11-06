import type { Workbook } from '@workbook/core/model';

export type RecordAdmissionRequest = {
  rowId: string;
  values: Readonly<Record<string, string>>;
  revision: number;
  before: Workbook;
  rowOrders: readonly { sheetId: string; order: readonly string[] }[];
};

export type RecordAdmissionResult = {
  rowId: string;
  alreadyCommitted: boolean;
  workbook: Workbook;
};
