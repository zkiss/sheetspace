import type { SheetDocument } from '@workbook/core/model';

import { projectSelection, type Selection } from './selection';

export type FormattingSelection = Selection;

export type ValidFormattingSelection = {
  valid: true;
  sheetId: string;
  mode: FormattingSelection['mode'];
  rows: readonly string[];
  columns: readonly string[];
  selectedRows: readonly string[];
  selectedColumns: readonly string[];
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
  const projection = projectSelection(sheet, selection);
  if (!projection) return { valid: false };
  const { anchorRow, extentRow, anchorColumn, extentColumn } = projection.endpoints;

  const rowStart = selection.mode === 'rows' ? projection.bounds.rowStart : Math.min(anchorRow, extentRow);
  const rowEnd = selection.mode === 'rows' ? projection.bounds.rowEnd : Math.max(anchorRow, extentRow);
  const columnStart = selection.mode === 'columns' ? projection.bounds.columnStart : Math.min(anchorColumn, extentColumn);
  const columnEnd = selection.mode === 'columns' ? projection.bounds.columnEnd : Math.max(anchorColumn, extentColumn);
  const effectiveRowStart = selection.mode === 'columns' ? 0 : rowStart;
  const effectiveRowEnd = selection.mode === 'columns' ? sheet.content.rows.length - 1 : rowEnd;
  const effectiveColumnStart = selection.mode === 'rows' ? 0 : columnStart;
  const effectiveColumnEnd = selection.mode === 'rows' ? sheet.content.columns.length - 1 : columnEnd;
  const selectedRows = projection.rows;
  const selectedColumns = projection.columns;

  return {
    valid: true,
    sheetId: sheet.id,
    mode: selection.mode,
    rows: sheet.content.rows,
    columns: sheet.content.columns,
    selectedRows,
    selectedColumns,
    rowStart,
    rowEnd,
    columnStart,
    columnEnd,
    effectiveRowStart,
    effectiveRowEnd,
    effectiveColumnStart,
    effectiveColumnEnd,
    effectiveSize: selectedRows.length * selectedColumns.length,
    writeCount: selection.mode === 'cells' ? selectedRows.length * selectedColumns.length : selection.mode === 'rows' ? selectedRows.length : selectedColumns.length,
  };
}
