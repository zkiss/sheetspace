import type { CellAddress, CellRange, SheetDocument, WorkspacePosition } from './workbook';
import { clampSheetFrameSize } from './workspaceGeometry';

export const GRID_CELL_WIDTH = 76;
export const GRID_CELL_HEIGHT = 26.4;
export const GRID_ROW_HEADER_WIDTH = 40;
export const GRID_COLUMN_HEADER_HEIGHT = 26.4;
export const SHEET_HEADER_HEIGHT = 42;

export function sheetContentOffsetForCell(address: CellAddress): WorkspacePosition {
  return {
    x: Math.round(address.columnIndex * GRID_CELL_WIDTH),
    y: Math.round(address.rowIndex * GRID_CELL_HEIGHT),
  };
}

export function rangeFitsSheetViewport(range: CellRange, sheet: SheetDocument) {
  const frameSize = clampSheetFrameSize(sheet.frame.size);
  const rangeWidth = (range.end.columnIndex - range.start.columnIndex + 1) * GRID_CELL_WIDTH;
  const rangeHeight = (range.end.rowIndex - range.start.rowIndex + 1) * GRID_CELL_HEIGHT;
  const availableWidth = frameSize.width - GRID_ROW_HEADER_WIDTH;
  const availableHeight =
    frameSize.height - SHEET_HEADER_HEIGHT - GRID_COLUMN_HEADER_HEIGHT;

  return rangeWidth <= availableWidth && rangeHeight <= availableHeight;
}
