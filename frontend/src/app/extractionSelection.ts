import type { ExtractionSelection } from '@application/core/extractionPreparation';
import type { CellSelection } from '@grid/cellInteractionContracts';
import type { SheetDocument } from '@workbook/core/model';
import { selectionEndpointAddressRange } from './workspaceSelection';
import type { ExtractionRequest } from '@application/core/extractionPreparation';

/** Convert a current grid selection to the stable identities used by extraction. */
export function extractionSelection(sheet: SheetDocument, selection: CellSelection | null): ExtractionSelection | undefined {
  if (!selection || selection.anchor.sheetId !== sheet.id || selection.extent.sheetId !== sheet.id
    || !selectionEndpointAddressRange(sheet, selection)) return undefined;
  const { anchor, extent } = selection;
  if (selection.mode === 'rows') return { kind: 'rows', start: anchor.cell.rowId, end: extent.cell.rowId };
  if (selection.mode === 'columns') return { kind: 'columns', start: anchor.cell.columnId, end: extent.cell.columnId };
  return { kind: 'cells', start: anchor.cell, end: extent.cell };
}

export function mappedExtractionSelection(sheet: SheetDocument, selection: CellSelection, request: ExtractionRequest): CellSelection | undefined {
  const range = selectionEndpointAddressRange(sheet, selection);
  if (!range) return undefined;
  const map = (target: CellSelection['anchor']) => {
    const rowId = request.targetRows[sheet.content.rows.indexOf(target.cell.rowId) - range.start.rowIndex];
    const columnId = request.targetColumns[sheet.content.columns.indexOf(target.cell.columnId) - range.start.columnIndex];
    return rowId && columnId ? { sheetId: request.targetSheetId, cell: { rowId, columnId } } : undefined;
  };
  const anchor = map(selection.anchor), extent = map(selection.extent);
  return anchor && extent ? { mode: selection.mode, anchor, extent } : undefined;
}
