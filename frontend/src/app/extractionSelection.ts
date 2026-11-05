import type { ExtractionSelection } from '@application/core/extractionPreparation';
import type { CellSelection } from '@grid/cellInteractionContracts';
import type { SheetDocument } from '@workbook/core/model';
import { rectangularSelectionAddressRange } from './workspaceSelection';
import { projectSelection } from '@workbook/read/selection';
import type { ExtractionRequest } from '@application/core/extractionPreparation';

/** Convert a current grid selection to the stable identities used by extraction. */
export function extractionSelection(sheet: SheetDocument, selection: CellSelection | null): ExtractionSelection | undefined {
  const projection = selection && projectSelection(sheet, selection);
  if (!selection || !projection?.rectangular) return undefined;
  const { anchor, extent } = selection;
  if (selection.mode === 'rows') {
    const reversed = projection.endpoints.anchorRow > projection.endpoints.extentRow;
    return { kind: 'rows', start: projection.rows[reversed ? projection.rows.length - 1 : 0]!, end: projection.rows[reversed ? 0 : projection.rows.length - 1]! };
  }
  if (selection.mode === 'columns') {
    const reversed = projection.endpoints.anchorColumn > projection.endpoints.extentColumn;
    return { kind: 'columns', start: projection.columns[reversed ? projection.columns.length - 1 : 0]!, end: projection.columns[reversed ? 0 : projection.columns.length - 1]! };
  }
  return { kind: 'cells', start: anchor.cell, end: extent.cell };
}

export function mappedExtractionSelection(sheet: SheetDocument, selection: CellSelection, request: ExtractionRequest): CellSelection | undefined {
  const range = rectangularSelectionAddressRange(sheet, selection);
  if (!range) return undefined;
  const map = (target: CellSelection['anchor']) => {
    const rowId = request.targetRows[sheet.content.rows.indexOf(target.cell.rowId) - range.start.rowIndex];
    const columnId = request.targetColumns[sheet.content.columns.indexOf(target.cell.columnId) - range.start.columnIndex];
    return rowId && columnId ? { sheetId: request.targetSheetId, cell: { rowId, columnId } } : undefined;
  };
  const anchor = map(selection.anchor), extent = map(selection.extent);
  const members = selection.members?.map((id) => selection.mode === 'rows'
    ? request.targetRows[sheet.content.rows.indexOf(id) - range.start.rowIndex]
    : request.targetColumns[sheet.content.columns.indexOf(id) - range.start.columnIndex]);
  if (members?.some((id) => !id)) return undefined;
  return anchor && extent ? { mode: selection.mode, anchor, extent, ...(members ? { members: members as string[] } : {}) } : undefined;
}
