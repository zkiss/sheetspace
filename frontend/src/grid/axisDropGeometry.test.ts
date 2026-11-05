import { describe, expect, it } from 'vitest';
import { axisDropGap, axisGatherBlock, axisPointerOffset } from './axisDropGeometry';
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

  it('accepts both saved endpoint gaps but not adjacent creating slots', () => {
    const axes: readonly GridAxisEntry<string>[] = [
      { kind: 'creating', operationId: 'before', boundary: 0 },
      { kind: 'saved', id: 'a', durableIndex: 0 },
      { kind: 'saved', id: 'b', durableIndex: 1 },
      { kind: 'creating', operationId: 'after', boundary: 2 },
    ];
    const sizes = createGridAxisMetrics(axes, [10, 20, 40, 10]);
    expect([9, 10, 69, 70, 80].map((offset) => axisDropGap(axes, sizes, offset)))
      .toEqual([undefined, 0, 2, undefined, undefined]);
  });

  it('converts screen coordinates to scrolled logical coordinates at visual scale', () => {
    expect(axisPointerOffset(160, 100, 2, 20)).toBe(50);
    expect(axisPointerOffset(160, 100, 0, 20)).toBeUndefined();
    expect(axisPointerOffset(Infinity, 100, 2, 20)).toBeUndefined();
  });

  it('computes the gathered block from selected sizes and the original gap', () => {
    const axes: readonly GridAxisEntry<string>[] = ['a', 'b', 'c', 'd'].map((id, durableIndex) => ({ kind: 'saved', id, durableIndex }));
    const sizes = createGridAxisMetrics(axes, [10, 20, 30, 40]);
    expect(axisGatherBlock(axes, sizes, ['b', 'd'], 3)).toEqual({ start: 40, size: 60 });
    expect(axisGatherBlock(axes, sizes, ['b', 'd'], 0)).toEqual({ start: 0, size: 60 });
    expect(axisGatherBlock(axes, sizes, ['b', 'd'], 4)).toEqual({ start: 40, size: 60 });
    expect(axisGatherBlock(entries, metrics, ['b'], 2)).toEqual({ start: 30, size: 40 });
  });

  it('rejects invalid block sources and gaps', () => {
    expect(axisGatherBlock(entries, metrics, [], 1)).toBeUndefined();
    expect(axisGatherBlock(entries, metrics, ['a', 'a'], 1)).toBeUndefined();
    expect(axisGatherBlock(entries, metrics, ['missing'], 1)).toBeUndefined();
    expect(axisGatherBlock(entries, metrics, ['a'], 3)).toBeUndefined();
    expect(axisGatherBlock(entries, metrics, ['a'], 0.5)).toBeUndefined();
    expect(axisGatherBlock(entries, createGridAxisMetrics(entries.slice(0, 1), 10), ['a'], 1)).toBeUndefined();
  });
});
