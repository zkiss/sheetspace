import { describe, expect, it } from 'vitest';
import { axisDropGap, axisPointerOffset } from './axisDropGeometry';
import { createGridAxisMetrics } from './gridAxisMetrics';
import type { GridAxisEntry } from './gridAxisProjection';

const entries: readonly GridAxisEntry<string>[] = [
  { kind: 'saved', id: 'a', durableIndex: 0 },
  { kind: 'creating', operationId: 'pending', boundary: 1 },
  { kind: 'saved', id: 'b', durableIndex: 1 },
];
const metrics = createGridAxisMetrics(entries, [20, 10, 40]);

describe('axis drop geometry', () => {
  it('finds durable insertion gaps using variable item midpoints and endpoint boundaries', () => {
    expect([0, 9, 10, 19, 30, 49, 50, 70].map((offset) => axisDropGap(entries, metrics, offset)))
      .toEqual([0, 0, 1, 1, 1, 1, 2, 2]);
  });

  it('rejects creating slots, outside positions, invalid positions and an empty axis', () => {
    expect([20, 29, -1, 71, NaN].map((offset) => axisDropGap(entries, metrics, offset)))
      .toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(axisDropGap([], createGridAxisMetrics([], 10), 0)).toBeUndefined();
    expect(axisDropGap(entries.slice(0, 2), createGridAxisMetrics(entries.slice(0, 2), 10), 20)).toBeUndefined();
  });

  it('converts screen coordinates to scrolled logical coordinates at visual scale', () => {
    expect(axisPointerOffset(160, 100, 2, 20)).toBe(50);
    expect(axisPointerOffset(160, 100, 0, 20)).toBeUndefined();
    expect(axisPointerOffset(Infinity, 100, 2, 20)).toBeUndefined();
  });
});
