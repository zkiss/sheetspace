import { describe, expect, it, vi } from 'vitest';
import {
  clampSheetFrameSize,
  clampWorkspaceZoom,
  getViewportCenter,
  getWorkspacePoint,
  resizeSheetFrame,
} from './workspaceGeometry';

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

    expect(getWorkspacePoint({ clientX: 320, clientY: 260 }, element, viewport)).toEqual({ x: 110, y: 130 });
    expect(getViewportCenter(element, viewport)).toEqual({ x: 210, y: 220 });
  });

  it('clamps sheet frame sizes to practical minimum dimensions', () => {
    expect(clampSheetFrameSize({ width: 10, height: 20 })).toEqual({ width: 180, height: 120 });
    expect(clampSheetFrameSize({ width: 320, height: 220 })).toEqual({ width: 320, height: 220 });
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
});
