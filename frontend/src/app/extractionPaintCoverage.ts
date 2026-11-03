import { cellKey, type CellRange } from '@workbook/core/address';

type Rect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

function intersection(...rects: Rect[]): Rect | null {
  const rect = { left: Math.max(...rects.map((r) => r.left)), top: Math.max(...rects.map((r) => r.top)),
    right: Math.min(...rects.map((r) => r.right)), bottom: Math.min(...rects.map((r) => r.bottom)) };
  return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
}

function aperture(frame: Element): Rect | null {
  const body = frame.querySelector('.sheet-frame-body');
  const corner = frame.querySelector('.sheet-grid-corner');
  if (!body || !corner) return null;
  const bounds = body.getBoundingClientRect();
  const header = corner.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0 || header.width <= 0 || header.height <= 0) return null;
  return { left: header.right, top: header.bottom, right: bounds.right, bottom: bounds.bottom };
}

function paintable(cell: Element, surface: Element): boolean {
  for (let element: Element | null = cell; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || (style.opacity !== '' && Number(style.opacity) < 1)) return false;
    if (element === surface) return true;
  }
  return false;
}

export function sourceApertureOutsideSurface(surface: Element, source: Element): boolean {
  const sourceAperture = aperture(source);
  const clip = surface.getBoundingClientRect();
  return !!sourceAperture && clip.width > 0 && clip.height > 0 && !intersection(sourceAperture, clip);
}

/** Conservative committed-cell coverage: missing source cells are unknown, never evidence of invisibility. */
export function extractionPaintCoverage(surface: Element, source: Element, target: Element, range: CellRange): boolean {
  const sourceAperture = aperture(source), targetAperture = aperture(target);
  const clip = surface.getBoundingClientRect();
  if (!sourceAperture || !targetAperture || clip.width <= 0 || clip.height <= 0) return false;
  const rows = range.end.rowIndex - range.start.rowIndex + 1;
  const columns = range.end.columnIndex - range.start.columnIndex + 1;
  if (rows <= 0 || columns <= 0 || rows * columns > 10000) return false;
  let visible = false;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const sourceKey = cellKey({ rowIndex: range.start.rowIndex + row, columnIndex: range.start.columnIndex + column });
    const targetKey = cellKey({ rowIndex: row, columnIndex: column });
    const sourceCell = source.querySelector(`[data-cell-key="${sourceKey}"]`);
    if (!sourceCell) return false;
    const sourceRect = sourceCell.getBoundingClientRect();
    const fragment = intersection(sourceRect, sourceAperture, clip);
    if (!fragment) continue;
    visible = true;
    const targetCell = target.querySelector(`[data-cell-key="${targetKey}"]`);
    if (!targetCell || sourceCell.textContent !== targetCell.textContent || !paintable(targetCell, surface)) return false;
    const targetRect = targetCell.getBoundingClientRect();
    const covered = intersection(targetRect, targetAperture, clip);
    if (!covered || Math.abs(sourceRect.left - targetRect.left) > 1 || Math.abs(sourceRect.top - targetRect.top) > 1
      || Math.abs(sourceRect.right - targetRect.right) > 1 || Math.abs(sourceRect.bottom - targetRect.bottom) > 1
      || covered.left > fragment.left + 1 || covered.top > fragment.top + 1
      || covered.right < fragment.right - 1 || covered.bottom < fragment.bottom - 1) return false;
  }
  return visible;
}
