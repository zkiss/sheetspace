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
