import type { SheetDocument } from '@workbook/core/model';

export type FormattingSelection = {
  mode: 'cells' | 'rows' | 'columns';
  anchor: { sheetId: string; cell: { rowId: string; columnId: string } };
  extent: { sheetId: string; cell: { rowId: string; columnId: string } };
};

export type ValidFormattingSelection = {
  valid: true;
  sheetId: string;
  mode: FormattingSelection['mode'];
  rows: readonly string[];
  columns: readonly string[];
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  effectiveRowStart: number;
  effectiveRowEnd: number;
  effectiveColumnStart: number;
  effectiveColumnEnd: number;
  effectiveSize: number;
  writeCount: number;
};

export type FormattingSelectionValidation = ValidFormattingSelection | { valid: false };

/** Resolves stable endpoints against the current axes without materializing targets. */
export function validateFormattingSelection(
  sheet: Pick<SheetDocument, 'id' | 'content'> | undefined,
  selection: FormattingSelection | null,
): FormattingSelectionValidation {
  if (!sheet || !selection || selection.anchor.sheetId !== sheet.id || selection.extent.sheetId !== sheet.id) return { valid: false };
  const anchorRow = sheet.content.rows.indexOf(selection.anchor.cell.rowId);
  const extentRow = sheet.content.rows.indexOf(selection.extent.cell.rowId);
  const anchorColumn = sheet.content.columns.indexOf(selection.anchor.cell.columnId);
  const extentColumn = sheet.content.columns.indexOf(selection.extent.cell.columnId);
  if (anchorRow < 0 || extentRow < 0 || anchorColumn < 0 || extentColumn < 0) return { valid: false };

  const rowStart = Math.min(anchorRow, extentRow);
  const rowEnd = Math.max(anchorRow, extentRow);
  const columnStart = Math.min(anchorColumn, extentColumn);
  const columnEnd = Math.max(anchorColumn, extentColumn);
  const effectiveRowStart = selection.mode === 'columns' ? 0 : rowStart;
  const effectiveRowEnd = selection.mode === 'columns' ? sheet.content.rows.length - 1 : rowEnd;
  const effectiveColumnStart = selection.mode === 'rows' ? 0 : columnStart;
  const effectiveColumnEnd = selection.mode === 'rows' ? sheet.content.columns.length - 1 : columnEnd;
  const selectedRows = rowEnd - rowStart + 1;
  const selectedColumns = columnEnd - columnStart + 1;

  return {
    valid: true,
    sheetId: sheet.id,
    mode: selection.mode,
    rows: sheet.content.rows,
    columns: sheet.content.columns,
    rowStart,
    rowEnd,
    columnStart,
    columnEnd,
    effectiveRowStart,
    effectiveRowEnd,
    effectiveColumnStart,
    effectiveColumnEnd,
    effectiveSize: (effectiveRowEnd - effectiveRowStart + 1) * (effectiveColumnEnd - effectiveColumnStart + 1),
    writeCount: selection.mode === 'cells' ? selectedRows * selectedColumns : selection.mode === 'rows' ? selectedRows : selectedColumns,
  };
}
