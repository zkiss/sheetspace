import type { WorkspacePosition } from '@workbook/core/model';

export type PendingSheetCreation = {
  position: WorkspacePosition;
  label: string;
};

export type PendingSheetRename = {
  sheetId: string;
  currentName: string;
};
