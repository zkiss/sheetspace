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
});
