import { describe, expect, it } from 'vitest';
import { minimapCenteredViewport, minimapDraggedViewport, minimapPoint, minimapProjection, minimapRect, minimapWorldPoint } from './minimapGeometry';
import { workspaceRectForFrame, workspaceViewportBounds } from './workspaceGeometry';

const surface = { width: 800, height: 400 };
const viewport = { x: 0, y: 0, scale: 1 };
const size = { width: 200, height: 120 };
const frame = (x: number, y: number, visualScale = 1) => ({ position: { x, y }, size: { width: 200, height: 120 }, visualScale });

describe('minimap geometry', () => {
  it('fits the viewport and scaled sheets with preserved aspect and padding', () => {
    const frames = [frame(-200, 0, 0.5), frame(1000, 200, 2)];
    const projection = minimapProjection(frames, surface, viewport, size, 10)!;
    expect(projection.world).toEqual({ left: -200, top: 0, right: 1400, bottom: 440 });
    expect(projection.scale).toBeCloseTo(180 / 1600);
    const first = minimapRect(projection, workspaceRectForFrame(frames[0]));
    const second = minimapRect(projection, workspaceRectForFrame(frames[1]));
    expect(first.left).toBeCloseTo(10);
    expect(first.right - first.left).toBeCloseTo(11.25);
    expect(second.right - second.left).toBeCloseTo(45);
    expect(second.bottom - second.top).toBeCloseTo(27);
    expect(second.right).toBeCloseTo(190);
  });

  it('includes a panned and zoomed viewport outside a single sheet', () => {
    const current = { x: -2000, y: 1000, scale: 2 };
    const projection = minimapProjection([frame(0, 0)], surface, current, size)!;
    expect(workspaceViewportBounds(surface, current)).toEqual({ left: 1000, top: -500, right: 1400, bottom: -300 });
    expect(projection.world).toEqual({ left: 0, top: -500, right: 1400, bottom: 120 });
    const point = { x: 1000, y: -500 };
    expect(minimapWorldPoint(projection, minimapPoint(projection, point)).x).toBeCloseTo(point.x);
    expect(minimapWorldPoint(projection, minimapPoint(projection, point)).y).toBeCloseTo(point.y);
  });

  it('centers clicks and translates drags using a stable snapshot without changing zoom', () => {
    const current = { x: 80, y: -40, scale: 2 };
    const projection = minimapProjection([], surface, current, size)!;
    const click = minimapPoint(projection, { x: 100, y: 150 });
    const centered = minimapCenteredViewport(projection, click, surface, current);
    expect(centered.x).toBeCloseTo(200);
    expect(centered.y).toBeCloseTo(-100);
    expect(centered.scale).toBe(2);
    const start = minimapPoint(projection, { x: 0, y: 0 });
    const end = minimapPoint(projection, { x: 20, y: -30 });
    const dragged = minimapDraggedViewport(projection, start, end, current);
    expect(dragged.x).toBeCloseTo(40);
    expect(dragged.y).toBeCloseTo(20);
    expect(dragged.scale).toBe(2);
  });

  it('handles empty, tiny and unmeasured surfaces', () => {
    const projection = minimapProjection([], surface, viewport, { width: 2, height: 1 })!;
    expect(projection.scale).toBeGreaterThan(0);
    expect(minimapRect(projection, projection.world).right).toBeLessThanOrEqual(2);
    expect(minimapProjection([], { width: 0, height: 1 }, viewport, size)).toBeNull();
    expect(minimapProjection([], surface, viewport, { width: 0, height: 1 })).toBeNull();
    expect(minimapProjection([], surface, viewport, { width: Infinity, height: 1 })).toBeNull();
  });

  it('keeps widely separated and extreme finite layouts and navigation finite', () => {
    const projection = minimapProjection([frame(-Number.MAX_VALUE, -1e100), frame(Number.MAX_VALUE, 1e100)], surface, viewport, size)!;
    const point = minimapPoint(projection, { x: Number.MAX_VALUE, y: 1e100 });
    expect(Object.values(point).every(Number.isFinite)).toBe(true);
    expect(Object.values(minimapWorldPoint(projection, point)).every(Number.isFinite)).toBe(true);
    expect(Object.values(minimapDraggedViewport(projection, { x: 0, y: 0 }, { x: 200, y: 100 }, viewport)).every(Number.isFinite)).toBe(true);
  });

  it('preserves relative placement and navigation beyond a quarter of the finite range', () => {
    const projection = minimapProjection([frame(5e307, 0), frame(1e308, 0)], surface, viewport, size)!;
    const first = minimapPoint(projection, { x: 5e307, y: 0 });
    const second = minimapPoint(projection, { x: 1e308, y: 0 });
    expect(second.x - first.x).toBeCloseTo(92);
    expect(minimapWorldPoint(projection, first).x / 5e307).toBeCloseTo(1);
    expect(minimapCenteredViewport(projection, second, surface, viewport).x / -1e308).toBeCloseTo(1);
  });

  it('round trips across a world span larger than the finite number range', () => {
    const projection = minimapProjection([frame(-1e308, 0), frame(1e308, 0)], surface, viewport, size)!;
    const point = minimapPoint(projection, { x: 1e308, y: 0 });
    expect(point.x).toBeCloseTo(192);
    expect(minimapWorldPoint(projection, point).x / 1e308).toBeCloseTo(1);
    expect(minimapCenteredViewport(projection, point, surface, viewport).x / -1e308).toBeCloseTo(1);
  });

  it('combines extreme drag deltas with zoom and pan before saturation', () => {
    const projection = minimapProjection([frame(-1e308, -1e308), frame(1e308, 1e308)], surface, viewport, size)!;
    const pixels = 1e308 * projection.scale;
    const start = { x: 0, y: 0 };
    const end = { x: pixels * 2, y: pixels * 2 };
    const small = minimapDraggedViewport(projection, start, end, { x: 0, y: 0, scale: 0.1 });
    expect(small.x / -2e307).toBeCloseTo(1);
    expect(small.y / -2e307).toBeCloseTo(1);
    expect(minimapDraggedViewport(projection, end, start, { x: 0, y: 0, scale: 0.1 }).x / 2e307).toBeCloseTo(1);
    expect(minimapDraggedViewport(projection, start, end, { x: 1e308, y: 0, scale: 1 }).x / -1e308).toBeCloseTo(1);
    expect(minimapDraggedViewport(projection, end, start, { x: -1e308, y: 0, scale: 1 }).x / 1e308).toBeCloseTo(1);
    expect(minimapDraggedViewport(projection, start, end, { x: 0, y: 0, scale: 8 }).x).toBe(-Number.MAX_VALUE);
    expect(minimapDraggedViewport(projection, start, start, viewport)).toEqual(viewport);
  });

  it('centers beyond a finite world endpoint without clamping before zoom', () => {
    const projection = minimapProjection([frame(-1e308, 0), frame(1e308, 0)], surface, viewport, size)!;
    const centered = minimapCenteredViewport(projection, { x: 200, y: 60 }, surface, { ...viewport, scale: 0.1 });
    expect(centered.x / (-0.1 * (1e308 + 8 / projection.scale))).toBeCloseTo(1);
    expect(minimapWorldPoint(projection, { x: 192, y: 60 }).x / 1e308).toBeCloseTo(1);
  });

  it('handles tiny pointer movements without overflowing the zoom to projection ratio', () => {
    const projection = { world: { left: 0, top: 0, right: 1, bottom: 1 }, scale: 1e-308, offset: { x: 0, y: 0 } };
    const dragged = minimapDraggedViewport(projection, { x: 0, y: 0 }, { x: 1e-308, y: 0 }, { x: 0, y: 0, scale: 8 });
    expect(dragged.x).toBeCloseTo(-8);
    expect(minimapPoint({ ...projection, scale: 1 }, { x: Number.MIN_VALUE, y: 0 }).x).toBe(Number.MIN_VALUE);
  });

  it('preserves mirrored extreme positions and saturates only unrepresentable navigation', () => {
    const projection = minimapProjection([frame(-1e308, 0), frame(-5e307, 0)], surface, viewport, size)!;
    const left = minimapPoint(projection, { x: -1e308, y: 0 });
    const right = minimapPoint(projection, { x: -5e307, y: 0 });
    expect(right.x - left.x).toBeCloseTo(92);
    expect(minimapWorldPoint(projection, right).x / -5e307).toBeCloseTo(1);
    expect(minimapCenteredViewport(projection, left, surface, { ...viewport, scale: 0.1 }).x / 1e307).toBeCloseTo(1);
    expect(minimapCenteredViewport(projection, left, surface, { ...viewport, scale: 8 }).x).toBe(Number.MAX_VALUE);
  });

  it('projects nearby representable positions before scaling large common origins', () => {
    for (const origin of [1e20, -1e20]) {
      const end = origin + 1e6;
      const projection = { world: { left: origin, top: origin, right: end, bottom: end },
        scale: 184 / (end - origin), offset: { x: 8, y: 8 } };
      const middle = origin + 16384;
      expect(minimapPoint(projection, { x: origin, y: origin })).toEqual({ x: 8, y: 8 });
      const point = minimapPoint(projection, { x: middle, y: middle });
      expect(point.x).toBeCloseTo(8 + (middle - origin) * projection.scale, 10);
      expect(point.y).toBeCloseTo(point.x, 10);
      expect(minimapPoint(projection, { x: end, y: end }).x).toBeCloseTo(192, 10);
      expect(point.x).toBeGreaterThan(8);
      expect(point.x).toBeLessThan(192);
    }
  });

  it('groups nearby pointer and offset coordinates for inverse, click and drag', () => {
    for (const origin of [1e20, -1e20]) {
      const projection = { world: { left: 100, top: -100, right: 200, bottom: 200 },
        scale: 2, offset: { x: origin, y: origin } };
      const point = { x: origin + 16384, y: origin + 16384 };
      const delta = point.x - origin;
      expect(minimapWorldPoint(projection, point)).toEqual({ x: 100 + delta / 2, y: -100 + delta / 2 });
      for (const zoom of [0.1, 1, 8]) {
        const current = { x: 20, y: -30, scale: zoom };
        const centered = minimapCenteredViewport(projection, point, surface, current);
        expect(centered.x).toBeCloseTo(400 - (100 + delta / 2) * zoom, 8);
        expect(centered.y).toBeCloseTo(200 - (-100 + delta / 2) * zoom, 8);
        const dragged = minimapDraggedViewport(projection, projection.offset, point, current);
        expect(dragged.x).toBeCloseTo(20 - delta * zoom / 2, 8);
        expect(dragged.y).toBeCloseTo(-30 - delta * zoom / 2, 8);
        expect(dragged.scale).toBe(zoom);
      }
    }
  });
});
