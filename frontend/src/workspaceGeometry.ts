import type { MouseEvent, PointerEvent, WheelEvent } from 'react';
import type { SheetFrameSize, WorkspacePosition } from './workbook';
import type { SheetFrameResize, WorkspaceViewport } from './appTypes';

export const MIN_SHEET_FRAME_WIDTH = 180;
export const MIN_SHEET_FRAME_HEIGHT = 120;
export const WORKSPACE_PAN_STEP = 80;
export const WORKSPACE_ZOOM_STEP = 0.2;
export const MIN_WORKSPACE_ZOOM = 0.5;
export const MAX_WORKSPACE_ZOOM = 2;
export const MIN_READABLE_CELL_SCALE = 0.75;
const NAVIGATION_PADDING = 48;

export type WorkspaceTargetRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

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

export function viewportForTarget({
  currentViewport,
  surfaceHeight,
  surfaceWidth,
  target,
  forceOversized = false,
}: {
  currentViewport: WorkspaceViewport;
  surfaceHeight: number;
  surfaceWidth: number;
  target: WorkspaceTargetRect;
  forceOversized?: boolean;
}): { oversized: boolean; viewport: WorkspaceViewport } {
  if (surfaceWidth <= 0 || surfaceHeight <= 0) {
    return { oversized: false, viewport: currentViewport };
  }

  const targetWidth = Math.max(1, target.right - target.left);
  const targetHeight = Math.max(1, target.bottom - target.top);
  const availableWidth = Math.max(1, surfaceWidth - NAVIGATION_PADDING * 2);
  const availableHeight = Math.max(1, surfaceHeight - NAVIGATION_PADDING * 2);
  const fitScale = Math.min(availableWidth / targetWidth, availableHeight / targetHeight);
  const oversized = forceOversized || fitScale < MIN_READABLE_CELL_SCALE;
  const scale = oversized
    ? Math.max(currentViewport.scale, MIN_READABLE_CELL_SCALE)
    : fitScale < currentViewport.scale
      ? clampWorkspaceZoom(fitScale)
      : currentViewport.scale;

  if (oversized) {
    return {
      oversized,
      viewport: {
        x: Math.round(NAVIGATION_PADDING - target.left * scale),
        y: Math.round(NAVIGATION_PADDING - target.top * scale),
        scale,
      },
    };
  }

  const left = target.left * scale + currentViewport.x;
  const right = target.right * scale + currentViewport.x;
  const top = target.top * scale + currentViewport.y;
  const bottom = target.bottom * scale + currentViewport.y;
  let x = currentViewport.x;
  let y = currentViewport.y;

  if (left < NAVIGATION_PADDING) {
    x += NAVIGATION_PADDING - left;
  } else if (right > surfaceWidth - NAVIGATION_PADDING) {
    x -= right - (surfaceWidth - NAVIGATION_PADDING);
  }

  if (top < NAVIGATION_PADDING) {
    y += NAVIGATION_PADDING - top;
  } else if (bottom > surfaceHeight - NAVIGATION_PADDING) {
    y -= bottom - (surfaceHeight - NAVIGATION_PADDING);
  }

  if (scale !== currentViewport.scale) {
    x = Math.round((surfaceWidth - targetWidth * scale) / 2 - target.left * scale);
    y = Math.round((surfaceHeight - targetHeight * scale) / 2 - target.top * scale);
  }

  return {
    oversized,
    viewport: { x: Math.round(x), y: Math.round(y), scale },
  };
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
