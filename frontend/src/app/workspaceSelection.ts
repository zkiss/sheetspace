import type { CellRange } from '@workbook/core/address';
import { addressRangeOf } from '@workbook/core/cellIdentity';
import type { SheetDocument } from '@workbook/core/model';
import type { CellSelection } from '@grid/cellInteractionContracts';

export function selectionAddressRange(sheet: SheetDocument, selection: CellSelection): CellRange | undefined {
  const range = addressRangeOf(sheet.content, { start: selection.anchor.cell, end: selection.extent.cell });
  if (!range) return undefined;
  const rowStart = Math.min(range.start.rowIndex, range.end.rowIndex);
  const rowEnd = Math.max(range.start.rowIndex, range.end.rowIndex);
  const columnStart = Math.min(range.start.columnIndex, range.end.columnIndex);
  const columnEnd = Math.max(range.start.columnIndex, range.end.columnIndex);
  return {
    start: { rowIndex: selection.mode === 'columns' ? 0 : rowStart, columnIndex: selection.mode === 'rows' ? 0 : columnStart },
    end: { rowIndex: selection.mode === 'columns' ? sheet.content.rows.length - 1 : rowEnd, columnIndex: selection.mode === 'rows' ? sheet.content.columns.length - 1 : columnEnd },
  };
}
