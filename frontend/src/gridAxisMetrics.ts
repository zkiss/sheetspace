import type { GridAxisEntry } from './gridAxisProjection';

export type GridAxisItemSize<Id extends string> =
  | number
  | readonly number[]
  | ((entry: GridAxisEntry<Id>, index: number) => number);

export type GridScrollAlignment = 'start' | 'center' | 'end';

export type GridAxisMetrics = {
  readonly count: number;
  readonly totalSize: number;
  itemKey(index: number): string | undefined;
  itemSize(index: number): number | undefined;
  itemOffset(index: number): number | undefined;
  indexAtOffset(offset: number): number | undefined;
  scrollOffsetForIndex(index: number, viewportSize: number, alignment?: GridScrollAlignment): number | undefined;
};

/**
 * Geometry for a projected axis. Positions deliberately use projection indexes:
 * A1 positions remain the `durableIndex` carried by saved entries.
 */
export function createGridAxisMetrics<Id extends string>(
  entries: readonly GridAxisEntry<Id>[],
  sizes: GridAxisItemSize<Id>,
): GridAxisMetrics {
  const itemSizes = entries.map((entry, index) => normalizedSize(sizeForItem(sizes, entry, index)));
  const offsets: number[] = [];
  let totalSize = 0;

  for (const size of itemSizes) {
    offsets.push(totalSize);
    totalSize += size;
  }

  function isIndex(index: number) {
    return Number.isInteger(index) && index >= 0 && index < entries.length;
  }

  return {
    count: entries.length,
    totalSize,
    itemKey(index) {
      const entry = entries[index];
      if (!isIndex(index) || !entry) return undefined;
      return entry.kind === 'saved' ? entry.id : entry.operationId;
    },
    itemSize(index) {
      return isIndex(index) ? itemSizes[index] : undefined;
    },
    itemOffset(index) {
      return isIndex(index) ? offsets[index] : undefined;
    },
    indexAtOffset(offset) {
      if (!Number.isFinite(offset) || offset < 0 || offset >= totalSize) return undefined;
      let low = 0;
      let high = offsets.length - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const itemEnd = offsets[middle] + itemSizes[middle];
        if (offset < offsets[middle]) high = middle - 1;
        else if (offset >= itemEnd) low = middle + 1;
        else return middle;
      }
      return undefined;
    },
    scrollOffsetForIndex(index, viewportSize, alignment = 'start') {
      if (!isIndex(index)) return undefined;
      const itemSize = itemSizes[index];
      const offset = offsets[index];
      const visibleSize = Math.max(0, viewportSize);
      const target = alignment === 'end'
        ? offset + itemSize - visibleSize
        : alignment === 'center'
          ? offset + itemSize / 2 - visibleSize / 2
          : offset;
      return Math.max(0, Math.min(Math.max(0, totalSize - visibleSize), target));
    },
  };
}

function sizeForItem<Id extends string>(
  sizes: GridAxisItemSize<Id>,
  entry: GridAxisEntry<Id>,
  index: number,
) {
  if (typeof sizes === 'function') return sizes(entry, index);
  return typeof sizes === 'number' ? sizes : sizes[index] ?? 0;
}

function normalizedSize(size: number) {
  return Number.isFinite(size) ? Math.max(0, size) : 0;
}
