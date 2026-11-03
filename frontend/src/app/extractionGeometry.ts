import { sheetContentOffsetForCell } from '@grid/gridGeometry';
import type { CellAddress } from '@workbook/core/address';
import type { SheetDocument, SheetFrameSize, WorkspacePosition } from '@workbook/core/model';
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
  targetSize: SheetFrameSize = source.frame.size,
): WorkspacePosition {
  const offset = sheetContentOffsetForCell(origin, source);
  const body = sheetFrameBodyGeometry(targetSize);
  const targetScale = viewport.scale * clampSheetVisualScale(source.frame.visualScale);
  const cellX = presentation.body.left + (GRID_ROW_HEADER_WIDTH + offset.x - scroll.x) * presentation.tableScale;
  const cellY = presentation.body.top + (GRID_COLUMN_HEADER_HEIGHT + offset.y - scroll.y) * presentation.tableScale;
  return {
    x: (cellX - (body.left + GRID_ROW_HEADER_WIDTH) * targetScale - viewport.x) / viewport.scale,
    y: (cellY - (body.top + GRID_COLUMN_HEADER_HEIGHT) * targetScale - viewport.y) / viewport.scale,
  };
}

/** Present the target at the source's current cell scale before settling to canvas geometry. */
export function extractionOverlayPresentation(
  source: SheetDocument,
  origin: CellAddress,
  scroll: WorkspacePosition,
  displayed: SheetPresentation,
  targetSize: SheetFrameSize,
): SheetPresentation {
  const offset = sheetContentOffsetForCell(origin, source);
  const body = sheetFrameBodyGeometry(targetSize);
  const scale = displayed.tableScale;
  const left = displayed.body.left + (offset.x - scroll.x) * scale;
  const top = displayed.body.top + (offset.y - scroll.y) * scale;
  return {
    frame: { left: left - body.left * scale, top: top - body.top * scale, width: targetSize.width * scale, height: targetSize.height * scale },
    body: { left, top, width: body.width * scale, height: body.height * scale },
    tableScale: scale,
    chrome: 1,
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
