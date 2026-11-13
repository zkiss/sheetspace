import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from './gridGeometry';
import { logicalUnitsPerRenderedPixel } from './gridScrollInput';

export function ensureCellVisibleOutsideStickyHeaders(
  cell: HTMLElement,
  scrollContainer: HTMLElement,
  columnHeader: HTMLElement | null,
  rowHeader: HTMLElement | null,
) {
  const cellRect = cell.getBoundingClientRect();
  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  const logicalPerRenderedPixel = logicalUnitsPerRenderedPixel(scrollContainer, scrollContainerRect);
  const visibleTop = scrollContainerRect.top
    + (columnHeader?.getBoundingClientRect().height ?? GRID_COLUMN_HEADER_HEIGHT / logicalPerRenderedPixel.y);
  const visibleLeft = scrollContainerRect.left
    + (rowHeader?.getBoundingClientRect().width ?? GRID_ROW_HEADER_WIDTH / logicalPerRenderedPixel.x);
  const visibleBottom = scrollContainerRect.top + scrollContainer.clientHeight / logicalPerRenderedPixel.y;
  const visibleRight = scrollContainerRect.left + scrollContainer.clientWidth / logicalPerRenderedPixel.x;
  if (cellRect.top < visibleTop) {
    scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop
      - (visibleTop - cellRect.top) * logicalPerRenderedPixel.y);
  } else if (cellRect.bottom > visibleBottom) {
    scrollContainer.scrollTop += (cellRect.bottom - visibleBottom) * logicalPerRenderedPixel.y;
  }
  if (cellRect.left < visibleLeft) {
    scrollContainer.scrollLeft = Math.max(0, scrollContainer.scrollLeft
      - (visibleLeft - cellRect.left) * logicalPerRenderedPixel.x);
  } else if (cellRect.right > visibleRight) {
    scrollContainer.scrollLeft += (cellRect.right - visibleRight) * logicalPerRenderedPixel.x;
  }
}
