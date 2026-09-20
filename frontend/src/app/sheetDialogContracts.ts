import type { WorkspacePosition } from '@workbook/core/model';

export type PendingSheetCreation = {
  position: WorkspacePosition;
  viewportScale: number;
  label: string;
};

export type PendingSheetRename = {
  sheetId: string;
  currentName: string;
};
