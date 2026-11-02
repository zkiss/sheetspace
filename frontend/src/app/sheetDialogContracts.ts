import type { WorkspacePosition } from '@workbook/core/model';

export type PendingSheetCreation = {
  position: WorkspacePosition;
  viewportScale: number;
  label: string;
  confirm: () => void;
};

export type PendingSheetRename = {
  sheetId: string;
  currentName: string;
};

/** The transient workspace presentation that owns the visible editor. */
export type PresentationSnapshot = {
  generation: number;
  canvas: boolean;
};
