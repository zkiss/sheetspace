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
  const references = new Map<string, { sheetName: string; rows: Map<string, number>; columns: Map<string, string> }>();
  for (const sheet of sheetsInOrder(workbook)) {
    const names = namedColumns(workbook, sheet);
    const named = new Map(names.map((column) => [column.columnId, column.name]));
    const usedNames = new Set(names.map((column) => column.name));
    const columns = new Map<string, string>();
    sheet.content.columns.forEach((columnId, columnIndex) => {
      const name = named.get(columnId);
      const label = columnIndexToLabel(columnIndex);
      const property = name ? formatPropertyReferenceToken(name) : `${usedNames.has(label) ? '%' : ''}${label}`;
      columns.set(columnId, property);
    });
    references.set(sheet.id, { sheetName: formatSheetReferenceToken(sheet.name), rows: new Map(sheet.content.rows.map((id, index) => [id, index + 1])), columns });
  }
  type Item = { node: FormulaDiagnostic; depth: number; exit?: boolean } | { graph: NonNullable<FormulaDiagnostic['structural']>['graph']; id: string; depth: number; exit?: boolean };
  const stack: Item[] = [{ node: diagnostic, depth: 0 }];
  const expanded = new Set<object | string>();
  const active = new Set<object | string>();
  while (stack.length) {
    const item = stack.pop()!;
    const structural = 'graph' in item ? item : item.node.structural ? { ...item.node.structural, id: item.node.structural.root, depth: item.depth, exit: item.exit } : undefined;
    const identity = structural ? structural.graph.nodes.get(structural.id)! : 'node' in item ? item.node : '';
    if (item.exit) { active.delete(identity); continue; }
    const node = structural ? structural.graph.nodes.get(structural.id)! : (item as { node: FormulaDiagnostic }).node;
    const repeated = expanded.has(identity);
    const marker = repeated ? (active.has(identity) ? 'Cycle reference: ' : 'Already shown: ') : '';
    const cell = node.cell;
    const sheet = cell && references.get(cell.sheetId);
    const row = cell && sheet?.rows.get(cell.rowId);
    const column = cell && sheet?.columns.get(cell.columnId);
    const target = cell && sheet && row && column ? { sheetId: cell.sheetId, cell: { rowId: cell.rowId, columnId: cell.columnId }, reference: `@${sheet.sheetName}!${column}[${row}]` } : undefined;
    lines.push({ key: String(lines.length), depth: item.depth, message: marker + node.message, target });
    if (repeated) continue;
    expanded.add(identity);
    active.add(identity);
    stack.push({ ...item, exit: true });
    if (structural) {
      const dependencies = structural.graph.nodes.get(structural.id)!.dependencies;
      for (let i = dependencies.length - 1; i >= 0; i--) stack.push({ graph: structural.graph, id: dependencies[i], depth: item.depth + 1 });
    } else {
      const causes = (node as FormulaDiagnostic).causes;
      for (let i = causes.length - 1; i >= 0; i--) stack.push({ node: causes[i], depth: item.depth + 1 });
    }
  }
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
      let trace: readonly ErrorTraceLine[] | undefined;
      return [{ key: JSON.stringify([sheet.id, cell.rowId, cell.columnId]), sheetId: sheet.id, cell, reference: target!.reference, code: result.error, text: errorDescriptions[result.error], get trace() { return diagnostic ? (trace ??= errorTrace(workbook, diagnostic)) : undefined; }, rowIndex, columnIndex }];
    }).sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
  });
}
