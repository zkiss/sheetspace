import { describe, expect, it } from 'vitest';
import { sheetCreationPlacement } from './sheetCreationPlacement';

describe('sheet creation placement', () => {
  it('centers the full frame in a panned and zoomed surface', () => {
    expect(sheetCreationPlacement({ width: 1000, height: 800 }, { x: 100, y: -50, scale: 2 })).toEqual({ x: 140, y: 185 });
  });

  it('cascades at a constant screen distance at any zoom', () => {
    const viewport = { x: 100, y: -50, scale: 2 };
    const size = { width: 1000, height: 800 };
    const first = sheetCreationPlacement(size, viewport);
    const second = sheetCreationPlacement(size, viewport, first);
    expect(second).toEqual({ x: first.x + 18, y: first.y + 18 });
    expect(sheetCreationPlacement(size, viewport, second)).toEqual({ x: first.x + 36, y: first.y + 36 });
  });

  it('uses the clamped visual scale for displayed dimensions', () => {
    const position = sheetCreationPlacement({ width: 1000, height: 800 }, { x: 0, y: 0, scale: 0.1 });
    expect(position.x * 0.1 + 240 * 0.1 * 8 / 2).toBeCloseTo(500);
    expect(position.y * 0.1 + 160 * 0.1 * 8 / 2).toBeCloseTo(400);
  });
});
