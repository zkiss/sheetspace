import { describe, expect, it } from 'vitest';
import { createGridAxisMetrics } from './gridAxisMetrics';
import type { GridAxisEntry } from '@grid/gridAxisProjection';

const entries: readonly GridAxisEntry<string>[] = [
  { kind: 'saved', id: 'row-a', durableIndex: 0 },
  { kind: 'creating', operationId: 'insert-row', boundary: 1 },
  { kind: 'saved', id: 'row-b', durableIndex: 1 },
];

describe('createGridAxisMetrics', () => {
  it('uses durable IDs and creating operation IDs as stable keys', () => {
    const metrics = createGridAxisMetrics(entries, 24);

    expect(metrics.count).toBe(3);
    expect([0, 1, 2].map((index) => metrics.itemKey(index))).toEqual(['row-a', 'insert-row', 'row-b']);
  });

  it('supports fixed and per-item sizes with offsets and a total extent', () => {
    expect(createGridAxisMetrics(entries, 24).totalSize).toBe(72);

    const metrics = createGridAxisMetrics(entries, [10, 20, 30]);
    expect([0, 1, 2].map((index) => metrics.itemSize(index))).toEqual([10, 20, 30]);
    expect([0, 1, 2].map((index) => metrics.itemOffset(index))).toEqual([0, 10, 30]);
    expect(metrics.totalSize).toBe(60);
  });

  it('looks up exact item boundaries without leaking outside the axis', () => {
    const metrics = createGridAxisMetrics(entries, [10, 20, 30]);

    expect(metrics.indexAtOffset(0)).toBe(0);
    expect(metrics.indexAtOffset(10)).toBe(1);
    expect(metrics.indexAtOffset(30)).toBe(2);
    expect(metrics.indexAtOffset(59.9)).toBe(2);
    expect(metrics.indexAtOffset(-1)).toBeUndefined();
    expect(metrics.indexAtOffset(60)).toBeUndefined();
    expect(metrics.itemKey(3)).toBeUndefined();
    expect(metrics.itemOffset(-1)).toBeUndefined();
  });

  it('handles an empty axis and computes clamped logical scroll alignment', () => {
    const empty = createGridAxisMetrics([], 24);
    expect(empty.count).toBe(0);
    expect(empty.totalSize).toBe(0);
    expect(empty.indexAtOffset(0)).toBeUndefined();

    const metrics = createGridAxisMetrics(entries, [10, 20, 30]);
    expect(metrics.scrollOffsetForIndex(2, 25, 'start')).toBe(30);
    expect(metrics.scrollOffsetForIndex(2, 25, 'center')).toBe(32.5);
    expect(metrics.scrollOffsetForIndex(2, 25, 'end')).toBe(35);
    expect(metrics.scrollOffsetForIndex(3, 25)).toBeUndefined();
  });
});
