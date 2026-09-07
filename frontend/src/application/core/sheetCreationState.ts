import { DEFAULT_SHEET_FRAME_SIZE, type WorkspacePosition } from '@workbook/core/model';

/** A view-only frame shown while the server creates its SheetDocument. */
export type CreatingSheetFrame = {
  kind: 'creating';
  operationKey: string;
  name: string;
  position: WorkspacePosition;
  size: typeof DEFAULT_SHEET_FRAME_SIZE;
  zIndex: number;
};
