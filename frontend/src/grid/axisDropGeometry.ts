import type { GridAxisEntry } from './gridAxisProjection';
import type { GridAxisMetrics } from './gridAxisMetrics';

export function axisDropGap<Id extends string>(
  entries: readonly GridAxisEntry<Id>[], metrics: GridAxisMetrics, offset: number,
): number | undefined {
  if (!Number.isFinite(offset) || offset < 0 || offset > metrics.totalSize || !entries.length) return undefined;
  if (offset === metrics.totalSize) {
    const last = entries[entries.length - 1];
    return last.kind === 'saved' ? last.durableIndex + 1 : undefined;
  }
  const index = metrics.indexAtOffset(offset);
  if (index === undefined) return undefined;
  const entry = entries[index];
  const start = metrics.itemOffset(index);
  const size = metrics.itemSize(index);
  if (!entry || entry.kind !== 'saved' || start === undefined || size === undefined) return undefined;
  return entry.durableIndex + (offset >= start + size / 2 ? 1 : 0);
}

export function axisPointerOffset(client: number, origin: number, scale: number, scroll: number): number | undefined {
  if (![client, origin, scale, scroll].every(Number.isFinite) || scale <= 0) return undefined;
  return (client - origin) / scale + scroll;
}

export function axisGatherBlock<Id extends string>(
  entries: readonly GridAxisEntry<Id>[], metrics: GridAxisMetrics, ids: readonly Id[], gap: number,
): { start: number; size: number } | undefined {
  const selected = new Set(ids);
  const saved = entries.filter((entry) => entry.kind === 'saved');
  if (!selected.size || selected.size !== ids.length || !Number.isInteger(gap) || gap < 0 || gap > saved.length) return undefined;
  let start = 0;
  let size = 0;
  let found = 0;
  for (const [index, entry] of entries.entries()) {
    const itemSize = metrics.itemSize(index);
    if (itemSize === undefined) return undefined;
    if (entry.kind === 'creating') {
      if (entry.boundary < gap) start += itemSize;
    } else if (selected.has(entry.id)) {
      size += itemSize;
      found += 1;
    } else if (entry.durableIndex < gap) {
      start += itemSize;
    }
  }
  return found === selected.size ? { start, size } : undefined;
}
