import type { ExtractionSelection } from '@application/core/extractionPreparation';
import type { CellSelection } from '@grid/cellInteractionContracts';
import type { SheetDocument } from '@workbook/core/model';
import { selectionAddressRange } from './workspaceSelection';

/** Convert a current grid selection to the stable identities used by extraction. */
export function extractionSelection(sheet: SheetDocument, selection: CellSelection | null): ExtractionSelection | undefined {
  if (!selection || selection.anchor.sheetId !== sheet.id || selection.extent.sheetId !== sheet.id
    || !selectionAddressRange(sheet, selection)) return undefined;
  const { anchor, extent } = selection;
  if (selection.mode === 'rows') return { kind: 'rows', start: anchor.cell.rowId, end: extent.cell.rowId };
  if (selection.mode === 'columns') return { kind: 'columns', start: anchor.cell.columnId, end: extent.cell.columnId };
  return { kind: 'cells', start: anchor.cell, end: extent.cell };
}
