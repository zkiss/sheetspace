import { formulaDiagnostic, type FormulaDiagnostic, type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
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
  trace?: readonly ErrorTraceLine[];
};

export type ErrorTraceLine = {
  key: string;
  depth: number;
  message: string;
  target?: { sheetId: string; cell: StableCellIdentity; reference: string };
};

export function cellReference(workbook: Workbook, identity: NonNullable<FormulaDiagnostic['cell']>): ErrorTraceLine['target'] {
  const sheet = sheetsInOrder(workbook).find((item) => item.id === identity.sheetId);
  if (!sheet) return undefined;
  const rowIndex = sheet.content.rows.indexOf(identity.rowId);
  const columnIndex = sheet.content.columns.indexOf(identity.columnId);
  if (rowIndex < 0 || columnIndex < 0) return undefined;
  const names = namedColumns(workbook, sheet);
  const name = names.find((column) => column.columnId === identity.columnId)?.name;
  const label = columnIndexToLabel(columnIndex);
  const address = `${name ? formatPropertyReferenceToken(name) : `${names.some((column) => column.name === label) ? '%' : ''}${label}`}[${rowIndex + 1}]`;
  return { sheetId: sheet.id, cell: { rowId: identity.rowId, columnId: identity.columnId }, reference: `@${formatSheetReferenceToken(sheet.name)}!${address}` };
}

export function errorTrace(workbook: Workbook, diagnostic: FormulaDiagnostic): ErrorTraceLine[] {
  const lines: ErrorTraceLine[] = [];
  const visit = (node: FormulaDiagnostic, key: string, depth: number) => {
    lines.push({ key, depth, message: node.message, target: node.cell ? cellReference(workbook, node.cell) : undefined });
    node.causes.forEach((child, index) => visit(child, `${key}.${index}`, depth + 1));
  };
  visit(diagnostic, '0', 0);
  return lines;
}

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
    return Object.entries(snapshot[sheet.id] ?? {}).flatMap(([key, result]) => {
      if (result.kind !== 'error') return [];
      const parsed = parseA1Address(key, { rowCount: sheet.content.rows.length, columnCount: sheet.content.columns.length });
      if (!parsed.ok) return [];
      const { rowIndex, columnIndex } = parsed.value;
      const cell = { rowId: sheet.content.rows[rowIndex], columnId: sheet.content.columns[columnIndex] };
      const target = cellReference(workbook, { sheetId: sheet.id, ...cell });
      const diagnostic = formulaDiagnostic(result);
      return [{ key: JSON.stringify([sheet.id, cell.rowId, cell.columnId]), sheetId: sheet.id, cell, reference: target!.reference, code: result.error, text: errorDescriptions[result.error], trace: diagnostic ? errorTrace(workbook, diagnostic) : undefined, rowIndex, columnIndex }];
    }).sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
  });
}
