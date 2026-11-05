import type { GridAxisEntry } from './gridAxisProjection';
import type { GridAxisMetrics } from './gridAxisMetrics';

export type AxisMotionItem = { id: string; index: number; start: number; size: number; delta: number };
export type AxisMotionSnapshot = readonly { key: string; saved: boolean; start: number; size: number }[];

export function axisMotionSnapshot<Id extends string>(entries: readonly GridAxisEntry<Id>[], metrics: GridAxisMetrics): AxisMotionSnapshot {
  return entries.map((entry, index) => ({
    key: entry.kind === 'saved' ? entry.id : entry.operationId,
    saved: entry.kind === 'saved',
    start: metrics.itemOffset(index) ?? 0,
    size: metrics.itemSize(index) ?? 0,
  }));
}

/** Return only identities intersecting either endpoint of the logical viewport. */
export function planAxisMotion(before: AxisMotionSnapshot, after: AxisMotionSnapshot, viewportStart: number, viewportSize: number): AxisMotionItem[] {
  if (before.length !== after.length) return [];
  const oldSaved = new Map(before.filter((item) => item.saved).map((item) => [item.key, item]));
  if (oldSaved.size !== before.filter((item) => item.saved).length) return [];
  const newSaved = after.filter((item) => item.saved);
  if (new Set(newSaved.map((item) => item.key)).size !== oldSaved.size) return [];
  let changed = false;
  for (let index = 0; index < after.length; index += 1) {
    const item = after[index];
    const previous = before[index];
    if (!item.saved || !previous.saved) {
      if (item.saved !== previous.saved || item.key !== previous.key || item.size !== previous.size) return [];
    } else if (item.key !== previous.key) changed = true;
    if (item.saved && oldSaved.get(item.key)?.size !== item.size) return [];
  }
  if (!changed) return [];
  const end = viewportStart + Math.max(0, viewportSize);
  const visible = (start: number, size: number) => start < end && start + size > viewportStart;
  return after.flatMap((item, index) => {
    if (!item.saved) return [];
    const old = oldSaved.get(item.key);
    if (!old || (!visible(old.start, old.size) && !visible(item.start, item.size))) return [];
    return [{ id: item.key, index, start: item.start, size: item.size, delta: old.start - item.start }];
  });
}
