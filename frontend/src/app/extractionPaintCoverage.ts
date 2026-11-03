import { cellKey, type CellRange } from '@workbook/core/address';
import type { SheetDocument } from '@workbook/core/model';
import { projectGridAxes } from '@grid/gridAxisProjection';
import { createSheetGridAxisMetrics, type GridAxisMetrics } from '@grid/gridAxisMetrics';

type Rect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

function intersection(...rects: Rect[]): Rect | null {
  const rect = { left: Math.max(...rects.map((r) => r.left)), top: Math.max(...rects.map((r) => r.top)),
    right: Math.min(...rects.map((r) => r.right)), bottom: Math.min(...rects.map((r) => r.bottom)) };
  return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
}

function aperture(frame: Element): Rect | 'empty' | null {
  const body = frame.querySelector<HTMLElement>('.sheet-frame-body');
  const corner = frame.querySelector('.sheet-grid-corner');
  if (!body || !corner) return null;
  if (hidden(body) || hidden(corner)) return 'empty';
  const bounds = body.getBoundingClientRect();
  const header = corner.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0 || header.width <= 0 || header.height <= 0) return null;
  const scale = body.offsetWidth ? bounds.width / body.offsetWidth : 1;
  return { left: header.right, top: header.bottom,
    right: body.clientWidth ? bounds.left + body.clientWidth * scale : bounds.right,
    bottom: body.clientHeight ? bounds.top + body.clientHeight * scale : bounds.bottom };
}

function hidden(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true;
  }
  return false;
}

type VisibleAxis = { first: number; last: number } | 'empty' | 'unknown';

function visibleAxis(axis: GridAxisMetrics, start: number, end: number, origin: number, scale: number, low: number, high: number): VisibleAxis {
  const firstOffset = axis.itemOffset(start), lastOffset = axis.itemOffset(end), lastSize = axis.itemSize(end);
  if (firstOffset === undefined || lastOffset === undefined || lastSize === undefined || scale <= 0) return 'unknown';
  const from = Math.max(firstOffset, (low - origin) / scale);
  const to = Math.min(lastOffset + lastSize, (high - origin) / scale);
  if (to <= from) return 'empty';
  const first = axis.indexAtOffset(from), last = axis.indexAtOffset(Math.max(from, to - 1e-7));
  return first === undefined || last === undefined ? 'unknown' : { first, last };
}

export function visibleExtractionCoverage(surface: Element, source: Element, target: Element | undefined,
  range: CellRange, sheet: SheetDocument): 'unknown' | 'empty' | 'waiting' | 'covered' {
  const sourceAperture = aperture(source), body = source.querySelector<HTMLElement>('.sheet-frame-body');
  const clip = surface.getBoundingClientRect();
  if (hidden(surface) || sourceAperture === 'empty') return 'empty';
  if (clip.width <= 0 || clip.height <= 0) return 'unknown';
  if (!sourceAperture || !body || !body.offsetWidth) return 'unknown';
  const visible = intersection(sourceAperture, clip);
  if (!visible) return 'empty';
  const scale = body.getBoundingClientRect().width / body.offsetWidth;
  const metrics = createSheetGridAxisMetrics(projectGridAxes(sheet.content), sheet.presentation);
  const columns = visibleAxis(metrics.columns, range.start.columnIndex, range.end.columnIndex,
    sourceAperture.left - body.scrollLeft * scale, scale, visible.left, visible.right);
  const rows = visibleAxis(metrics.rows, range.start.rowIndex, range.end.rowIndex,
    sourceAperture.top - body.scrollTop * scale, scale, visible.top, visible.bottom);
  if (columns === 'empty' || rows === 'empty') return 'empty';
  if (columns === 'unknown' || rows === 'unknown') return 'unknown';
  if (!target) return 'waiting';
  const targetAperture = aperture(target);
  if (!targetAperture || targetAperture === 'empty') return 'waiting';
  for (let row = rows.first; row <= rows.last; row++) for (let column = columns.first; column <= columns.last; column++) {
    const sourceKey = cellKey({ rowIndex: row, columnIndex: column });
    const targetKey = cellKey({ rowIndex: row - range.start.rowIndex, columnIndex: column - range.start.columnIndex });
    const sourceCell = source.querySelector(`[data-cell-key="${sourceKey}"]`);
    const targetCell = target.querySelector(`[data-cell-key="${targetKey}"]`);
    if (!sourceCell || !targetCell || sourceCell.textContent !== targetCell.textContent || !paintable(targetCell, surface)) return 'waiting';
    const sourceRect = sourceCell.getBoundingClientRect(), targetRect = targetCell.getBoundingClientRect();
    const fragment = intersection(sourceRect, visible), covered = intersection(targetRect, targetAperture, clip);
    if (!fragment || !covered || Math.abs(sourceRect.left - targetRect.left) > 1 || Math.abs(sourceRect.top - targetRect.top) > 1
      || Math.abs(sourceRect.right - targetRect.right) > 1 || Math.abs(sourceRect.bottom - targetRect.bottom) > 1
      || covered.left > fragment.left + 1 || covered.top > fragment.top + 1
      || covered.right < fragment.right - 1 || covered.bottom < fragment.bottom - 1) return 'waiting';
  }
  return 'covered';
}

function paintable(cell: Element, surface: Element): boolean {
  for (let element: Element | null = cell; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || (style.opacity !== '' && Number(style.opacity) < 1)) return false;
    if (element === surface) return true;
  }
  return false;
}
