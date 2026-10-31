import type { FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { columnIndexToLabel, parseA1Address } from '@workbook/core/address';
import { namedColumns } from '@workbook/core/columnNames';
import type { StableCellIdentity, Workbook } from '@workbook/core/model';
import { formatPropertyReferenceToken, formatSheetReferenceToken, type FormulaErrorCode } from '@workbook/formula/syntax';
import { sheetsInOrder } from '@workbook/read/queries';

export type WorkbookError = {
  key: string;
  sheetId: string;
  cell: StableCellIdentity;
  reference: string;
  code: FormulaErrorCode;
  text: string;
};

const errorDescriptions: Record<FormulaErrorCode, string> = {
  '#PARSE!': 'Invalid formula syntax',
  '#REF!': 'Invalid reference',
  '#NAME!': 'Unknown name',
  '#VALUE!': 'Invalid value',
  '#DIV/0!': 'Division by zero',
  '#CYCLE!': 'Circular reference',
  '#N/A': 'Value not available',
};

export function workbookErrors(workbook: Workbook, snapshot: FormulaEvaluationSnapshot): WorkbookError[] {
  return sheetsInOrder(workbook).flatMap((sheet) => {
    const names = namedColumns(workbook, sheet);
    return Object.entries(snapshot[sheet.id] ?? {}).flatMap(([key, result]) => {
      if (result.kind !== 'error') return [];
      const parsed = parseA1Address(key, { rowCount: sheet.content.rows.length, columnCount: sheet.content.columns.length });
      if (!parsed.ok) return [];
      const { rowIndex, columnIndex } = parsed.value;
      const cell = { rowId: sheet.content.rows[rowIndex], columnId: sheet.content.columns[columnIndex] };
      const name = names.find((column) => column.columnId === cell.columnId)?.name;
      const address = `${name ? formatPropertyReferenceToken(name) : columnIndexToLabel(columnIndex)}[${rowIndex + 1}]`;
      return [{ key: JSON.stringify([sheet.id, cell.rowId, cell.columnId]), sheetId: sheet.id, cell, reference: `@${formatSheetReferenceToken(sheet.name)}!${address}`, code: result.error, text: errorDescriptions[result.error], rowIndex, columnIndex }];
    }).sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
  });
}
