import type { SheetFrameSize, SheetFrameProjection, WorkspacePosition } from './workbook';
import type { SheetFrameResize, WorkspaceViewport } from './appTypes';

export const MIN_SHEET_FRAME_WIDTH = 180;
export const MIN_SHEET_FRAME_HEIGHT = 120;
export const WORKSPACE_PAN_STEP = 80;
export const WORKSPACE_ZOOM_STEP = 0.2;
export const MIN_WORKSPACE_ZOOM = 0.5;
export const MAX_WORKSPACE_ZOOM = 2;
export const MIN_READABLE_CELL_SCALE = 0.75;
/** Keeps nearby frames warm without making mounted work proportional to sheet count. */
export const WORKSPACE_FRAME_OVERSCAN = { horizontal: 320, vertical: 240 } as const;
const NAVIGATION_PADDING = 48;

export type WorkspaceTargetRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type WorkspaceOverscan = number | { horizontal: number; vertical: number };

export type VisibleSheetFrameOptions = {
  overscan?: WorkspaceOverscan;
  pinnedSheetIds?: ReadonlySet<string>;
};

export function workspaceViewportBounds(
  surfaceSize: SheetFrameSize,
  viewport: WorkspaceViewport,
): WorkspaceTargetRect {
  const scale = viewport.scale || 1;
  const left = -viewport.x / scale || 0;
  const top = -viewport.y / scale || 0;
  return {
    left,
    top,
    right: left + Math.max(0, surfaceSize.width) / scale,
    bottom: top + Math.max(0, surfaceSize.height) / scale,
  };
}

export function workspaceRectsIntersect(
  first: WorkspaceTargetRect,
  second: WorkspaceTargetRect,
  overscan: WorkspaceOverscan = 0,
) {
  const { horizontal, vertical } = normalizedOverscan(overscan);
  return first.left < second.right + horizontal
    && first.right > second.left - horizontal
    && first.top < second.bottom + vertical
    && first.bottom > second.top - vertical;
}

export function visibleSheetFrames(
  frames: readonly SheetFrameProjection[],
  viewportBounds: WorkspaceTargetRect,
  { overscan = 0, pinnedSheetIds = new Set<string>() }: VisibleSheetFrameOptions = {},
): readonly SheetFrameProjection[] {
  return frames.filter((frame) => pinnedSheetIds.has(frame.id)
    || workspaceRectsIntersect(workspaceRectForFrame(frame), viewportBounds, overscan));
}

export function workspacePointFromClient(
  clientPoint: WorkspacePosition,
  element: HTMLElement,
  viewport: WorkspaceViewport,
): WorkspacePosition {
  return workspacePointFromSurface(surfacePointFromClient(clientPoint, element), viewport);
}

export function workspacePointAtViewportCenter(element: HTMLElement, viewport: WorkspaceViewport): WorkspacePosition {
  const size = surfaceSize(element);
  return workspacePointFromSurface({ x: size.width / 2, y: size.height / 2 }, viewport);
}

export function workspacePointFromSurface(
  surfacePoint: WorkspacePosition,
  viewport: WorkspaceViewport,
): WorkspacePosition {
  return {
    x: Math.round((surfacePoint.x - viewport.x) / viewport.scale),
    y: Math.round((surfacePoint.y - viewport.y) / viewport.scale),
  };
}

export function workspaceDeltaFromClient(
  startClientPoint: WorkspacePosition,
  currentClientPoint: WorkspacePosition,
  viewportScale: number,
): WorkspacePosition {
  return {
    x: (currentClientPoint.x - startClientPoint.x) / viewportScale,
    y: (currentClientPoint.y - startClientPoint.y) / viewportScale,
  };
}

export function surfaceDeltaFromClient(
  startClientPoint: WorkspacePosition,
  currentClientPoint: WorkspacePosition,
): WorkspacePosition {
  return {
    x: currentClientPoint.x - startClientPoint.x,
    y: currentClientPoint.y - startClientPoint.y,
  };
}

export function clampWorkspaceZoom(scale: number) {
  return Math.min(MAX_WORKSPACE_ZOOM, Math.max(MIN_WORKSPACE_ZOOM, scale));
}

export function zoomViewportAt(
  currentViewport: WorkspaceViewport,
  nextScale: number,
  surfaceOrigin: WorkspacePosition = { x: 0, y: 0 },
): WorkspaceViewport {
  const scale = clampWorkspaceZoom(nextScale);
  const workspaceOrigin = {
    x: (surfaceOrigin.x - currentViewport.x) / currentViewport.scale,
    y: (surfaceOrigin.y - currentViewport.y) / currentViewport.scale,
  };

  return {
    x: Math.round(surfaceOrigin.x - workspaceOrigin.x * scale),
    y: Math.round(surfaceOrigin.y - workspaceOrigin.y * scale),
    scale,
  };
}

export function surfacePointFromClient(
  clientPoint: WorkspacePosition,
  element: HTMLElement,
): WorkspacePosition {
  const rect = element.getBoundingClientRect();
  return { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top };
}

export function surfaceSize(element: HTMLElement): SheetFrameSize {
  const rect = element.getBoundingClientRect();
  return {
    width: element.clientWidth || rect.width,
    height: element.clientHeight || rect.height,
  };
}

export function workspaceRectForFrame(
  frame: Pick<SheetFrameProjection, 'position' | 'size'>,
): WorkspaceTargetRect {
  const size = clampSheetFrameSize(frame.size);
  return {
    left: frame.position.x,
    top: frame.position.y,
    right: frame.position.x + size.width,
    bottom: frame.position.y + size.height,
  };
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

function normalizedOverscan(overscan: WorkspaceOverscan) {
  if (typeof overscan === 'number') {
    const size = Math.max(0, overscan);
    return { horizontal: size, vertical: size };
  }
  return {
    horizontal: Math.max(0, overscan.horizontal),
    vertical: Math.max(0, overscan.vertical),
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
