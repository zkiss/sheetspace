import { CellAddress, CellRange } from '@workbook/core/address';
import { SheetDocument, WorkspacePosition } from '@workbook/core/model';
import { clampSheetVisualScale, sheetFrameBodyGeometry } from '@workspace/workspaceGeometry';
import { SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE } from '@workbook/core/sheetRenderingPolicy';

import { projectGridAxes } from './gridAxisProjection';
import { createSheetGridAxisMetrics } from './gridAxisMetrics';

import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from '@workbook/core/axisSizePolicy';

export const GRID_CELL_WIDTH = DEFAULT_COLUMN_WIDTH;
export const GRID_CELL_HEIGHT = DEFAULT_ROW_HEIGHT;
export const GRID_ROW_HEADER_WIDTH = 40;
export const GRID_COLUMN_HEADER_HEIGHT = 26.4;

export function sheetContentOffsetForCell(address: CellAddress, sheet: SheetDocument): WorkspacePosition {
  const metrics = createSheetGridAxisMetrics(projectGridAxes(sheet.content), sheet.presentation);
  return { x: Math.round(metrics.columns.itemOffset(address.columnIndex) ?? 0),
    y: Math.round(metrics.rows.itemOffset(address.rowIndex) ?? 0) };
}

export function rangeFitsSheetViewport(range: CellRange, sheet: SheetDocument) {
  const body = sheetFrameBodyGeometry(sheet.frame.size);
  const metrics = createSheetGridAxisMetrics(projectGridAxes(sheet.content), sheet.presentation);
  const extent = (axis: typeof metrics.rows, start: number, end: number) =>
    (axis.itemOffset(end) ?? 0) + (axis.itemSize(end) ?? 0) - (axis.itemOffset(start) ?? 0);
  const availableWidth = body.width - GRID_ROW_HEADER_WIDTH;
  const availableHeight = body.height - GRID_COLUMN_HEADER_HEIGHT;
  return extent(metrics.columns, range.start.columnIndex, range.end.columnIndex) <= availableWidth
    && extent(metrics.rows, range.start.rowIndex, range.end.rowIndex) <= availableHeight;
}

/** Minimum workspace zoom that causes this sheet to enter detailed rendering. */
export function detailedViewportScaleForSheet(sheet: SheetDocument) {
  return SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE / clampSheetVisualScale(sheet.frame.visualScale);
}
