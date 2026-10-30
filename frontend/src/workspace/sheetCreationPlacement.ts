import { clampSheetVisualScale, DEFAULT_SHEET_FRAME_SIZE, type SheetFrameSize, type WorkspacePosition } from '@workbook/core/model';
import type { WorkspaceViewport } from './workspaceContracts';
import { workspacePointFromSurface } from './workspaceGeometry';

const CASCADE_STEP = 36;

export function sheetCreationPlacement(size: SheetFrameSize, viewport: WorkspaceViewport, previous?: WorkspacePosition): WorkspacePosition {
  if (previous) return { x: previous.x + CASCADE_STEP / viewport.scale, y: previous.y + CASCADE_STEP / viewport.scale };
  const screenScale = viewport.scale * clampSheetVisualScale(1 / viewport.scale);
  return workspacePointFromSurface({
    x: (size.width - DEFAULT_SHEET_FRAME_SIZE.width * screenScale) / 2,
    y: (size.height - DEFAULT_SHEET_FRAME_SIZE.height * screenScale) / 2,
  }, viewport);
}
