import { CellAddress, CellRange } from '@workbook/core/address';
import { SheetDocument, WorkspacePosition } from '@workbook/core/model';
import { clampSheetFrameSize } from '@workspace/workspaceGeometry';

import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from '@workbook/core/axisSizePolicy';

export const GRID_CELL_WIDTH = DEFAULT_COLUMN_WIDTH;
export const GRID_CELL_HEIGHT = DEFAULT_ROW_HEIGHT;
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
