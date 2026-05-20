import type { SheetFrameSize, WorkspacePosition } from './workbook';

export type PendingSheetCreation = {
  position: WorkspacePosition;
  label: string;
};

export type PendingSheetRename = {
  sheetId: string;
  currentName: string;
};

export type PendingSheetMenu = {
  sheetId: string;
  x: number;
  y: number;
};

export type ActiveCellSelection = {
  sheetId: string;
  cellKey: string;
};

export type EditingCell = ActiveCellSelection & {
  value: string;
};

export type CellNavigationDirection = 'left' | 'right' | 'up' | 'down';

export type WorkspaceViewport = {
  x: number;
  y: number;
  scale: number;
};

export type SheetFrameDrag = {
  pointerId: number;
  sheetId: string;
  startClientX: number;
  startClientY: number;
  startPosition: WorkspacePosition;
};

export type SheetFrameResizeDirection = {
  horizontal: -1 | 0 | 1;
  vertical: -1 | 0 | 1;
};

export type SheetFrameResize = {
  pointerId: number;
  sheetId: string;
  startClientX: number;
  startClientY: number;
  startPosition: WorkspacePosition;
  startFrameSize: SheetFrameSize;
  direction: SheetFrameResizeDirection;
};

export type SaveStatus = 'saved' | 'saving' | 'failed';

export type StartupLoadState =
  | { status: 'loading' }
  | { status: 'loaded' }
  | { status: 'error'; message: string };
