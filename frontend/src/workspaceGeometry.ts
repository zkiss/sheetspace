import type { MouseEvent, PointerEvent, WheelEvent } from 'react';
import type { SheetFrameSize, WorkspacePosition } from './workbook';
import type { SheetFrameResize, WorkspaceViewport } from './appTypes';

export const MIN_SHEET_FRAME_WIDTH = 180;
export const MIN_SHEET_FRAME_HEIGHT = 120;
export const WORKSPACE_PAN_STEP = 80;
export const WORKSPACE_ZOOM_STEP = 0.2;
export const MIN_WORKSPACE_ZOOM = 0.5;
export const MAX_WORKSPACE_ZOOM = 2;

export function getWorkspacePoint(
  event: Pick<MouseEvent<HTMLElement> | PointerEvent<HTMLElement> | WheelEvent<HTMLElement>, 'clientX' | 'clientY'>,
  element: HTMLElement,
  viewport: WorkspaceViewport,
): WorkspacePosition {
  const rect = element.getBoundingClientRect();

  return {
    x: Math.round((event.clientX - rect.left - viewport.x) / viewport.scale),
    y: Math.round((event.clientY - rect.top - viewport.y) / viewport.scale),
  };
}

export function getViewportCenter(element: HTMLElement, viewport: WorkspaceViewport): WorkspacePosition {
  return {
    x: Math.round((element.clientWidth / 2 - viewport.x) / viewport.scale),
    y: Math.round((element.clientHeight / 2 - viewport.y) / viewport.scale),
  };
}

export function clampWorkspaceZoom(scale: number) {
  return Math.min(MAX_WORKSPACE_ZOOM, Math.max(MIN_WORKSPACE_ZOOM, scale));
}

export function clampSheetFrameSize(frameSize: SheetFrameSize): SheetFrameSize {
  return {
    width: Math.max(MIN_SHEET_FRAME_WIDTH, frameSize.width),
    height: Math.max(MIN_SHEET_FRAME_HEIGHT, frameSize.height),
  };
}

export function resizeSheetFrame(
  resize: Pick<SheetFrameResize, 'startFrameSize' | 'startPosition' | 'direction'>,
  delta: WorkspacePosition,
) {
  const nextFrameSize = clampSheetFrameSize({
    width: Math.round(resize.startFrameSize.width + delta.x * resize.direction.horizontal),
    height: Math.round(resize.startFrameSize.height + delta.y * resize.direction.vertical),
  });

  return {
    position: {
      x:
        resize.direction.horizontal < 0
          ? Math.round(resize.startPosition.x + resize.startFrameSize.width - nextFrameSize.width)
          : resize.startPosition.x,
      y:
        resize.direction.vertical < 0
          ? Math.round(resize.startPosition.y + resize.startFrameSize.height - nextFrameSize.height)
          : resize.startPosition.y,
    },
    frameSize: nextFrameSize,
  };
}
