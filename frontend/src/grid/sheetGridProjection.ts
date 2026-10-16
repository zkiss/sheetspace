import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual';
import { cellKey, parseA1Address, type CellAddress, type CellRange } from '@workbook/core/address';
import { sheetBounds } from '@workbook/read/queries';
import type { SheetTabularProjection } from '@workbook/core/model';
import type { GridAxisProjection } from '@grid/gridAxisProjection';
import type { GridAxisMetrics } from './gridAxisMetrics';
import type { CellSelectionMode } from './cellInteractionContracts';
import { cellTargetAt } from '@grid/cellInteraction';

export function axisKey(entry: GridAxisProjection['rows'][number] | GridAxisProjection['columns'][number] | undefined) {
  return entry ? (entry.kind === 'saved' ? entry.id : entry.operationId) : '';
}

/**
 * Resolve pointer geometry to a durable axis item. Projection also contains
 * temporary creation slots, so generic metric indexes cannot be used directly
 * for selection. The closest saved item makes endpoint and pending-slot
 * targeting deterministic without changing the metrics API's out-of-range
 * contract.
 */
export function savedAxisIndexAtOffset(
  entries: readonly GridAxisProjection['rows'][number][] | readonly GridAxisProjection['columns'][number][],
  metrics: GridAxisMetrics,
  offset: number,
) {
  if (!Number.isFinite(offset)) return undefined;
  const saved = entries
    .map((entry, index) => entry?.kind === 'saved' ? index : undefined)
    .filter((index): index is number => index !== undefined);
  if (!saved.length) return undefined;

  const directIndex = metrics.indexAtOffset(offset);
  if (directIndex !== undefined && entries[directIndex]?.kind === 'saved') return directIndex;

  let nearestIndex = saved[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const index of saved) {
    const start = metrics.itemOffset(index) ?? 0;
    const end = start + (metrics.itemSize(index) ?? 0);
    const distance = offset < start ? start - offset : offset >= end ? offset - end : 0;
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

export function dragTargetForSource(
  source: HTMLElement,
  mode: CellSelectionMode,
  sheet: SheetTabularProjection,
  rows: GridAxisProjection['rows'],
  columns: GridAxisProjection['columns'],
) {
  if (mode === 'cells') {
    const key = source.dataset.cellKey;
    return key ? cellTargetAt(sheet, key) ?? null : null;
  }
  const durableIndex = Number(source.dataset.axisDurableIndex);
  if (!Number.isInteger(durableIndex)) return null;
  const firstRow = rows.find((axis) => axis.kind === 'saved');
  const firstColumn = columns.find((axis) => axis.kind === 'saved');
  if (!firstRow || !firstColumn) return null;
  return cellTargetAt(sheet, cellKey({
    columnIndex: mode === 'columns' ? durableIndex : firstColumn.durableIndex,
    rowIndex: mode === 'rows' ? durableIndex : firstRow.durableIndex,
  })) ?? null;
}

export function hasDurableIndex(
  entry: GridAxisProjection['rows'][number] | GridAxisProjection['columns'][number] | undefined,
  durableIndex: number,
) {
  return entry?.kind === 'saved' && entry.durableIndex === durableIndex;
}

export function parseCellAddress(key: string | null, sheet: SheetTabularProjection) {
  if (!key) return undefined;
  const parsed = parseA1Address(key, sheetBounds(sheet));
  return parsed.ok ? parsed.value : undefined;
}

export function axisIndexForDurableIndex(entries: readonly GridAxisProjection['rows'][number][], durableIndex: number) {
  return entries.findIndex((entry) => entry.kind === 'saved' && entry.durableIndex === durableIndex);
}

export function pinnedAxisIndices(entries: readonly GridAxisProjection['rows'][number][], durableIndices: readonly number[]) {
  return durableIndices.map((durableIndex) => axisIndexForDurableIndex(entries, durableIndex)).filter((index): index is number => index >= 0);
}

export function mergeVirtualIndexes<TScrollElement extends Element, TItemElement extends Element>(
  virtualItems: readonly VirtualItem[],
  pinnedIndexes: readonly number[],
  virtualizer: Virtualizer<TScrollElement, TItemElement>,
  paddingStart: number,
  metrics: GridAxisMetrics,
) {
  const items = new Map(virtualItems.map((item) => [item.index, item]));
  for (const index of pinnedIndexes) {
    const size = metrics.itemSize(index) ?? 0;
    const start = paddingStart + (metrics.itemOffset(index) ?? 0);
    const item = virtualizer.getVirtualItems().find((candidate) => candidate.index === index)
      ?? { end: start + size, index, key: metrics.itemKey(index) ?? index, lane: 0, size, start };
    if (!items.has(index)) items.set(index, item);
  }
  return [...items.values()].map((item) => {
    const size = metrics.itemSize(item.index) ?? 0;
    const start = paddingStart + (metrics.itemOffset(item.index) ?? 0);
    return { ...item, size, start, end: start + size };
  }).sort((left, right) => left.index - right.index);
}

export function virtualItemsOrTestFallback(items: readonly VirtualItem[], metrics: GridAxisMetrics, paddingStart: number) {
  if (items.length > 0) return items;
  // JSDOM reports a zero-sized scroll viewport; keep its deterministic projection bounded too.
  return Array.from({ length: Math.min(metrics.count, 30) }, (_, index) => {
    const size = metrics.itemSize(index) ?? 0;
    const start = paddingStart + (metrics.itemOffset(index) ?? 0);
    return {
      end: start + size,
      index,
      key: metrics.itemKey(index) ?? index,
      lane: 0,
      size,
      start,
    };
  });
}

export function isAddressInRange(address: CellAddress, range?: CellRange) {
  return Boolean(
    range
      && address.columnIndex >= range.start.columnIndex
      && address.columnIndex <= range.end.columnIndex
      && address.rowIndex >= range.start.rowIndex
      && address.rowIndex <= range.end.rowIndex,
  );
}
