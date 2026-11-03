import { sheetContentOffsetForCell } from '@grid/gridGeometry';
import type { CellAddress } from '@workbook/core/address';
import type { SheetDocument, WorkspacePosition } from '@workbook/core/model';
import { clampSheetVisualScale } from '@workspace/workspaceGeometry';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from '@grid/gridGeometry';
import { sheetFrameBodyGeometry } from '@workspace/workspaceGeometry';
import type { SheetPresentation } from '@workspace/maximiseGeometry';
import type { WorkspaceViewport } from '@workspace/workspaceContracts';

/** Align the target's first cell with the source's displayed cell, in surface pixels. */
export function displayedExtractionFramePosition(
  source: SheetDocument,
  origin: CellAddress,
  scroll: WorkspacePosition,
  presentation: SheetPresentation,
  viewport: WorkspaceViewport,
): WorkspacePosition {
  const offset = sheetContentOffsetForCell(origin, source);
  const body = sheetFrameBodyGeometry(source.frame.size);
  const targetScale = viewport.scale * clampSheetVisualScale(source.frame.visualScale);
  const cellX = presentation.body.left + (GRID_ROW_HEADER_WIDTH + offset.x - scroll.x) * presentation.tableScale;
  const cellY = presentation.body.top + (GRID_COLUMN_HEADER_HEIGHT + offset.y - scroll.y) * presentation.tableScale;
  return {
    x: (cellX - (body.left + GRID_ROW_HEADER_WIDTH) * targetScale - viewport.x) / viewport.scale,
    y: (cellY - (body.top + GRID_COLUMN_HEADER_HEIGHT) * targetScale - viewport.y) / viewport.scale,
  };
}

/** Place the unscrolled target's first cell at the source selection's content origin. */
export function extractionFramePosition(
  source: SheetDocument,
  origin: CellAddress,
  scroll: WorkspacePosition,
  sourcePosition: WorkspacePosition = source.frame.position,
): WorkspacePosition {
  const offset = sheetContentOffsetForCell(origin, source);
  const scale = clampSheetVisualScale(source.frame.visualScale);
  return {
    x: sourcePosition.x + (offset.x - scroll.x) * scale,
    y: sourcePosition.y + (offset.y - scroll.y) * scale,
  };
}
