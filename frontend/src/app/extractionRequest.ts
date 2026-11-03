import type { ExtractionRequest } from '@application/core/extractionPreparation';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { GRID_COLUMN_HEADER_HEIGHT, GRID_ROW_HEADER_WIDTH } from '@grid/gridGeometry';
import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from '@workbook/core/axisSizePolicy';
import type { SheetDocument, Workbook, WorkspacePosition } from '@workbook/core/model';
import { MIN_SHEET_FRAME_HEIGHT, MIN_SHEET_FRAME_WIDTH, SHEET_HEADER_HEIGHT } from '@workspace/workspaceGeometry';
import { extractionFramePosition } from './extractionGeometry';
import { extractionSelection } from './extractionSelection';
import { selectionAddressRange } from './workspaceSelection';

export function extractionRequest(workbook: Workbook, sheet: SheetDocument, selection: CellSelection, scroll: WorkspacePosition,
  position: WorkspacePosition = sheet.frame.position, newId: () => string = () => crypto.randomUUID()): ExtractionRequest | undefined {
  const selected = extractionSelection(sheet, selection);
  const range = selected && selectionAddressRange(sheet, selection);
  if (!selected || !range) return undefined;
  const rows = sheet.content.rows.slice(range.start.rowIndex, range.end.rowIndex + 1);
  const columns = sheet.content.columns.slice(range.start.columnIndex, range.end.columnIndex + 1);
  if (!rows.length || !columns.length) return undefined;
  const names = new Set(Object.values(workbook.documents).map((document) => document.name));
  let suffix = 1;
  while (names.has(`Sheet ${suffix}`)) suffix += 1;
  return {
    sourceSheetId: sheet.id, selection: selected, targetSheetId: newId(), targetName: `Sheet ${suffix}`,
    targetRows: rows.map(() => newId()), targetColumns: columns.map(() => newId()),
    frame: {
      position: extractionFramePosition(sheet, range.start, scroll, position),
      size: {
        width: Math.max(MIN_SHEET_FRAME_WIDTH, 2 + GRID_ROW_HEADER_WIDTH + columns.reduce((sum, id) => sum + (sheet.presentation.columnWidths[id] ?? DEFAULT_COLUMN_WIDTH), 0)),
        height: Math.max(MIN_SHEET_FRAME_HEIGHT, 2 + SHEET_HEADER_HEIGHT + GRID_COLUMN_HEADER_HEIGHT + rows.reduce((sum, id) => sum + (sheet.presentation.rowHeights[id] ?? DEFAULT_ROW_HEIGHT), 0)),
      },
      zIndex: sheet.frame.zIndex,
    },
  };
}
