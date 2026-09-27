import { CellAddress, CellRange } from '@workbook/core/address';
import { SheetDocument, WorkspacePosition } from '@workbook/core/model';
import { clampSheetFrameSize, clampSheetVisualScale } from '@workspace/workspaceGeometry';

import { projectGridAxes } from './gridAxisProjection';
import { createSheetGridAxisMetrics } from './gridAxisMetrics';

import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from '@workbook/core/axisSizePolicy';

export const GRID_CELL_WIDTH = DEFAULT_COLUMN_WIDTH;
export const GRID_CELL_HEIGHT = DEFAULT_ROW_HEIGHT;
export const GRID_ROW_HEADER_WIDTH = 40;
export const GRID_COLUMN_HEADER_HEIGHT = 26.4;
export const SHEET_HEADER_HEIGHT = 42;
// Mirrors the rendering-policy detail boundary while keeping grid model geometry
// independent from the workspace UI mode resolver.
const DETAILED_ENTRY_EFFECTIVE_SCALE = 0.5;

export function sheetContentOffsetForCell(address: CellAddress, sheet: SheetDocument): WorkspacePosition {
  const metrics = createSheetGridAxisMetrics(projectGridAxes(sheet.content), sheet.presentation);
  return { x: Math.round(metrics.columns.itemOffset(address.columnIndex) ?? 0),
    y: Math.round(metrics.rows.itemOffset(address.rowIndex) ?? 0) };
}

export function rangeFitsSheetViewport(range: CellRange, sheet: SheetDocument) {
  const frameSize = clampSheetFrameSize(sheet.frame.size);
  const metrics = createSheetGridAxisMetrics(projectGridAxes(sheet.content), sheet.presentation);
  const extent = (axis: typeof metrics.rows, start: number, end: number) =>
    (axis.itemOffset(end) ?? 0) + (axis.itemSize(end) ?? 0) - (axis.itemOffset(start) ?? 0);
  const availableWidth = frameSize.width - GRID_ROW_HEADER_WIDTH;
  const availableHeight = frameSize.height - SHEET_HEADER_HEIGHT - GRID_COLUMN_HEADER_HEIGHT;
  return extent(metrics.columns, range.start.columnIndex, range.end.columnIndex) <= availableWidth
    && extent(metrics.rows, range.start.rowIndex, range.end.rowIndex) <= availableHeight;
}

/**
 * The physical workspace rectangle occupied by a durable grid range.  This is
 * intentionally model-derived: reference navigation must be able to reveal a
 * culled overview without first mounting a grid just to inspect its DOM.
 */
export function workspaceRectForSheetRange(range: CellRange, sheet: SheetDocument) {
  const metrics = createSheetGridAxisMetrics(projectGridAxes(sheet.content), sheet.presentation);
  const visualScale = clampSheetVisualScale(sheet.frame.visualScale);
  const startX = GRID_ROW_HEADER_WIDTH + (metrics.columns.itemOffset(range.start.columnIndex) ?? 0);
  const startY = SHEET_HEADER_HEIGHT + GRID_COLUMN_HEADER_HEIGHT
    + (metrics.rows.itemOffset(range.start.rowIndex) ?? 0);
  const endX = GRID_ROW_HEADER_WIDTH
    + (metrics.columns.itemOffset(range.end.columnIndex) ?? 0)
    + (metrics.columns.itemSize(range.end.columnIndex) ?? 0);
  const endY = SHEET_HEADER_HEIGHT + GRID_COLUMN_HEADER_HEIGHT
    + (metrics.rows.itemOffset(range.end.rowIndex) ?? 0)
    + (metrics.rows.itemSize(range.end.rowIndex) ?? 0);
  return {
    left: sheet.frame.position.x + startX * visualScale,
    top: sheet.frame.position.y + startY * visualScale,
    right: sheet.frame.position.x + endX * visualScale,
    bottom: sheet.frame.position.y + endY * visualScale,
  };
}

/** Minimum workspace zoom that causes this sheet to enter detailed rendering. */
export function detailedViewportScaleForSheet(sheet: SheetDocument) {
  return DETAILED_ENTRY_EFFECTIVE_SCALE / clampSheetVisualScale(sheet.frame.visualScale);
}
