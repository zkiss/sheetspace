import type { SheetFrameSize, StableCellIdentity, StableCellRange, WorkspacePosition } from './workbook';

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

export type CellTarget = {
  sheetId: string;
  cell: StableCellIdentity;
};

export type ReferenceNavigationTarget =
  | { kind: 'cell'; target: CellTarget }
  | { kind: 'range'; sheetId: string; range: StableCellRange };

export type CellEditSession = {
  target: CellTarget;
  draft: string;
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
