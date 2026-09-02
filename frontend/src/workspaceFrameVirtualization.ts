import type { WorkspaceViewport } from './appTypes';
import { SheetFrameProjection, SheetFrameSize } from './workbook/core/model';
import {
  visibleSheetFrames,
  WORKSPACE_FRAME_OVERSCAN,
  workspaceViewportBounds,
} from './workspaceGeometry';

export type WorkspaceFramePins = {
  editingSheetId?: string | null;
  interactionSheetId?: string | null;
  navigationRevealSheetId?: string | null;
  pendingFocusSheetId?: string | null;
};

export function workspaceFramePinIds(pins: WorkspaceFramePins): ReadonlySet<string> {
  return new Set([
    pins.interactionSheetId,
    pins.editingSheetId,
    pins.pendingFocusSheetId,
    pins.navigationRevealSheetId,
  ].filter((sheetId): sheetId is string => Boolean(sheetId)));
}

export function mountedWorkspaceFrameIds({
  frames,
  pins,
  surfaceSize,
  viewport,
}: {
  frames: readonly SheetFrameProjection[];
  pins: WorkspaceFramePins;
  surfaceSize: SheetFrameSize | null;
  viewport: WorkspaceViewport;
}): ReadonlySet<string> {
  const pinnedSheetIds = workspaceFramePinIds(pins);
  // Do not construct detailed frames before the surface has a usable viewport.
  // Explicit pins remain mounted so an in-flight interaction or focus transfer
  // cannot be interrupted by a transient zero-size observation.
  if (!surfaceSize || surfaceSize.width <= 0 || surfaceSize.height <= 0) {
    return pinnedSheetIds;
  }

  return new Set(visibleSheetFrames(
    frames,
    workspaceViewportBounds(surfaceSize, viewport),
    {
      overscan: WORKSPACE_FRAME_OVERSCAN,
      pinnedSheetIds,
    },
  ).map((frame) => frame.id));
}
