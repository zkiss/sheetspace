import type { GridAxisMetrics } from './gridAxisMetrics';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from './gridGeometry';

/** Reveal independently on each axis, preserving an already visible cell's offset. */
export function gridCellReveal(
  metrics: { rows: GridAxisMetrics; columns: GridAxisMetrics },
  indices: { row: number; column: number },
  viewport: { width: number; height: number; left: number; top: number },
) {
  function axisReveal(axis: GridAxisMetrics, index: number, size: number, scroll: number, header: number) {
    const offset = axis.itemOffset(index);
    if (offset === undefined) return undefined;
    const itemSize = axis.itemSize(index)!;
    const start = offset + header;
    const end = start + itemSize;
    const visible = start >= scroll + header && end <= scroll + size;
    const nextScroll = visible ? scroll : Math.round(axis.scrollOffsetForIndex(index, Math.max(0, size - header))!);
    return {
      scroll: nextScroll,
      // Oversized cells can only reveal the part within the scrollport.
      start: Math.max(header, start - nextScroll),
      end: Math.min(size, end - nextScroll),
    };
  }
  return {
    row: axisReveal(metrics.rows, indices.row, viewport.height, viewport.top, GRID_COLUMN_HEADER_HEIGHT),
    column: axisReveal(metrics.columns, indices.column, viewport.width, viewport.left, GRID_ROW_HEADER_WIDTH),
  };
}
