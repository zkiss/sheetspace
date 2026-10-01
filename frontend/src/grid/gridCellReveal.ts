import type { GridAxisMetrics } from './gridAxisMetrics';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from './gridGeometry';

type GridMetrics = { rows: GridAxisMetrics; columns: GridAxisMetrics };
type GridIndices = { row: number; column: number };
type GridViewport = { width: number; height: number; left: number; top: number };

/** Reveal independently on each axis, preserving an already visible cell's offset. */
export function gridCellReveal(
  metrics: GridMetrics,
  indices: GridIndices,
  viewport: GridViewport,
) {
  return gridRangeReveal(metrics, { start: indices, end: indices }, viewport);
}

/** Reveal fitting ranges in full; oversized axes retain the anchor-cell policy. */
export function gridRangeReveal(
  metrics: GridMetrics,
  indices: { start: GridIndices; end: GridIndices },
  viewport: GridViewport,
) {
  function axisReveal(axis: GridAxisMetrics, index: number, endIndex: number, size: number, scroll: number, header: number) {
    const offset = axis.itemOffset(index);
    const endOffset = axis.itemOffset(endIndex);
    if (offset === undefined || endOffset === undefined) return undefined;
    const itemSize = axis.itemSize(index)!;
    const start = offset + header;
    const rangeEnd = endOffset + header + axis.itemSize(endIndex)!;
    const usableSize = Math.max(0, size - header);
    const end = rangeEnd - start <= usableSize ? rangeEnd : start + itemSize;
    const visible = start >= scroll + header && end <= scroll + size;
    // Scroll offsets are subpixel values. Rounding upward hides the cell's leading
    // edge under a sticky header; rounding at the grid end clips its trailing edge.
    const nextScroll = visible ? scroll : axis.scrollOffsetForIndex(index, usableSize)!;
    const revealedStart = Math.min(size, Math.max(header, start - nextScroll));
    return {
      scroll: nextScroll,
      // Oversized cells can only reveal the part within the scrollport.
      start: revealedStart,
      end: Math.max(revealedStart, Math.min(size, end - nextScroll)),
    };
  }
  return {
    row: axisReveal(metrics.rows, indices.start.row, indices.end.row, viewport.height, viewport.top, GRID_COLUMN_HEADER_HEIGHT),
    column: axisReveal(metrics.columns, indices.start.column, indices.end.column, viewport.width, viewport.left, GRID_ROW_HEADER_WIDTH),
  };
}
