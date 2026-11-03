import { sheetContentOffsetForCell } from '@grid/gridGeometry';
import type { CellAddress } from '@workbook/core/address';
import type { SheetDocument, WorkspacePosition } from '@workbook/core/model';
import { clampSheetVisualScale } from '@workspace/workspaceGeometry';

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
