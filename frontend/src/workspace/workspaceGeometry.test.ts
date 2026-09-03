import { describe, expect, it, vi } from 'vitest';
import {
  clampSheetFrameSize,
  clampWorkspaceZoom,
  resizeSheetFrame,
  surfacePointFromClient,
  surfaceDeltaFromClient,
  surfaceSize,
  viewportForTarget,
  workspaceDeltaFromClient,
  workspacePointAtViewportCenter,
  workspacePointFromClient,
  workspacePointFromSurface,
  workspaceRectForFrame,
  workspaceRectsIntersect,
  workspaceViewportBounds,
  visibleSheetFrames,
  zoomViewportAt,
} from '@workspace/workspaceGeometry';

function workspaceElement({
  clientWidth,
  clientHeight,
  left,
  top,
}: {
  clientWidth: number;
  clientHeight: number;
  left: number;
  top: number;
}) {
  const element = document.createElement('section');
  Object.defineProperty(element, 'clientWidth', { value: clientWidth });
  Object.defineProperty(element, 'clientHeight', { value: clientHeight });
  element.getBoundingClientRect = vi.fn(() => ({
    bottom: top + clientHeight,
    height: clientHeight,
    left,
    right: left + clientWidth,
    top,
    width: clientWidth,
    x: left,
    y: top,
    toJSON: () => undefined,
  }));
  return element;
}

describe('workspaceGeometry', () => {
  it('clamps workspace zoom to the supported range', () => {
    expect(clampWorkspaceZoom(0.1)).toBe(0.5);
    expect(clampWorkspaceZoom(1.25)).toBe(1.25);
    expect(clampWorkspaceZoom(8)).toBe(2);
  });

  it('converts viewport coordinates into workspace points and centers', () => {
    const element = workspaceElement({ clientWidth: 1000, clientHeight: 800, left: 20, top: 40 });
    const viewport = { x: 80, y: -40, scale: 2 };

    expect(surfacePointFromClient({ x: 320, y: 260 }, element)).toEqual({ x: 300, y: 220 });
    expect(surfaceSize(element)).toEqual({ width: 1000, height: 800 });
    expect(workspacePointFromSurface({ x: 300, y: 220 }, viewport)).toEqual({ x: 110, y: 130 });
    expect(workspacePointFromClient({ x: 320, y: 260 }, element, viewport)).toEqual({ x: 110, y: 130 });
    expect(workspacePointAtViewportCenter(element, viewport)).toEqual({ x: 210, y: 220 });
    expect(workspaceDeltaFromClient({ x: 100, y: 120 }, { x: 140, y: 150 }, 2))
      .toEqual({ x: 20, y: 15 });
    expect(surfaceDeltaFromClient({ x: 100, y: 120 }, { x: 140, y: 150 }))
      .toEqual({ x: 40, y: 30 });
  });

  it('zooms around a surface point while preserving its workspace location', () => {
    expect(zoomViewportAt(
      { x: 80, y: -40, scale: 1 },
      1.5,
      { x: 100, y: 100 },
    )).toEqual({ x: 70, y: -110, scale: 1.5 });
    expect(zoomViewportAt({ x: 0, y: 0, scale: 1 }, 10))
      .toEqual({ x: 0, y: 0, scale: 2 });
  });

  it('clamps sheet frame sizes to practical minimum dimensions', () => {
    expect(clampSheetFrameSize({ width: 10, height: 20 })).toEqual({ width: 180, height: 120 });
    expect(clampSheetFrameSize({ width: 320, height: 220 })).toEqual({ width: 320, height: 220 });
  });

  it('projects a clamped frame into workspace coordinates', () => {
    expect(workspaceRectForFrame({
      position: { x: 120, y: 80 },
      size: { width: 10, height: 20 },
    })).toEqual({ left: 120, top: 80, right: 300, bottom: 200 });
  });

  it('projects resized surfaces through pan and zoom into workspace bounds', () => {
    expect(workspaceViewportBounds(
      { width: 1000, height: 800 },
      { x: 80, y: -40, scale: 2 },
    )).toEqual({ left: -40, top: 20, right: 460, bottom: 420 });
    expect(workspaceViewportBounds(
      { width: -10, height: 0 },
      { x: 0, y: 0, scale: 1 },
    )).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it('selects intersecting and pinned frames with clamped frame sizes and overscan', () => {
    const frames = [
      { id: 'inside', name: 'Inside', position: { x: 10, y: 10 }, size: { width: 240, height: 160 }, zIndex: 1 },
      { id: 'edge', name: 'Edge', position: { x: -80, y: 0 }, size: { width: 20, height: 20 }, zIndex: 2 },
      { id: 'nearby', name: 'Nearby', position: { x: 290, y: 10 }, size: { width: 240, height: 160 }, zIndex: 3 },
      { id: 'pinned', name: 'Pinned', position: { x: 1000, y: 1000 }, size: { width: 240, height: 160 }, zIndex: 4 },
    ];
    const viewport = { left: 0, top: 0, right: 100, bottom: 100 };

    expect(workspaceRectsIntersect({ left: 100, top: 0, right: 200, bottom: 100 }, viewport)).toBe(false);
    expect(workspaceRectsIntersect({ left: 99, top: 0, right: 200, bottom: 100 }, viewport)).toBe(true);
    expect(visibleSheetFrames(frames, viewport).map((frame) => frame.id)).toEqual(['inside', 'edge']);
    expect(visibleSheetFrames(frames, viewport, { overscan: 191 }).map((frame) => frame.id))
      .toEqual(['inside', 'edge', 'nearby']);
    expect(visibleSheetFrames(frames, viewport, { pinnedSheetIds: new Set(['pinned']) }).map((frame) => frame.id))
      .toEqual(['inside', 'edge', 'pinned']);
  });

  it('anchors left and top resize handles while enforcing minimum frame size', () => {
    expect(
      resizeSheetFrame(
        {
          direction: { horizontal: -1, vertical: -1 },
          startFrameSize: { width: 240, height: 160 },
          startPosition: { x: 120, y: 80 },
        },
        { x: 100, y: 80 },
      ),
    ).toEqual({
      frameSize: { width: 180, height: 120 },
      position: { x: 180, y: 120 },
    });
  });

  it('pans an offscreen navigation target into the padded viewport', () => {
    expect(viewportForTarget({
      currentViewport: { x: 0, y: 0, scale: 1 },
      surfaceHeight: 600,
      surfaceWidth: 800,
      target: { left: 1200, top: 900, right: 1276, bottom: 927 },
    })).toEqual({
      oversized: false,
      viewport: { x: -524, y: -375, scale: 1 },
    });
  });

  it('fits a large cell-target frame when readable and top-aligns it when oversized', () => {
    expect(viewportForTarget({
      currentViewport: { x: 0, y: 0, scale: 1 },
      surfaceHeight: 600,
      surfaceWidth: 800,
      target: { left: 1800, top: 1200, right: 2700, bottom: 1800 },
    })).toEqual({
      oversized: false,
      viewport: { x: -1360, y: -873, scale: 0.7822222222222223 },
    });

    expect(viewportForTarget({
      currentViewport: { x: 0, y: 0, scale: 1 },
      surfaceHeight: 600,
      surfaceWidth: 800,
      target: { left: 1800, top: 1200, right: 3000, bottom: 2200 },
    })).toEqual({
      oversized: true,
      viewport: { x: -1752, y: -1152, scale: 1 },
    });
  });

  it('fits readable ranges but preserves readable scale for oversized ranges', () => {
    expect(viewportForTarget({
      currentViewport: { x: 0, y: 0, scale: 1 },
      surfaceHeight: 600,
      surfaceWidth: 800,
      target: { left: 100, top: 100, right: 860, bottom: 628 },
    })).toEqual({
      oversized: false,
      viewport: { x: -45, y: -37, scale: 0.9263157894736842 },
    });

    expect(viewportForTarget({
      currentViewport: { x: 0, y: 0, scale: 1 },
      surfaceHeight: 600,
      surfaceWidth: 800,
      target: { left: 100, top: 100, right: 1240, bottom: 1156 },
    })).toEqual({
      oversized: true,
      viewport: { x: -52, y: -52, scale: 1 },
    });
  });
});
