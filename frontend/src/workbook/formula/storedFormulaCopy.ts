import type { Workbook } from '../core/model';
import { workbookFormulaReferenceResolver, type FormulaCoordinate, type FormulaCopyContext } from './reference';
import { storedFormulaTransform } from './storedFormulaTransform';

export type StoredFormulaCopyResult = { ok: true; content: string } | { ok: false; reason: 'unresolved-coordinate' };

export function copyStoredFormula(content: string, source: FormulaCoordinate, destination: FormulaCoordinate, workbook: Workbook, context: Required<FormulaCopyContext>): StoredFormulaCopyResult {
  const transform = storedFormulaTransform(content, workbook);
  const resolver = workbookFormulaReferenceResolver(workbook, context.sourceSheetId);
  const origin = resolver.addressOf(context.sourceSheetId, source);
  const target = resolver.addressOf(context.destinationSheetId, destination);
  if (!origin || !target) return { ok: false, reason: 'unresolved-coordinate' };
  if (context.sourceSheetId === context.destinationSheetId && origin.columnIndex === target.columnIndex && origin.rowIndex === target.rowIndex) return { ok: true, content };
  for (const reference of transform.analysis.references) {
    if (!reference.occurrence || !reference.sheet) continue;
    const sheetId = reference.lexeme.qualifier ? reference.sheet.id : context.destinationSheetId;
    const sheet = workbook.documents[sheetId];
    if (!sheet) return { ok: false, reason: 'unresolved-coordinate' };
    const endpoints = reference.occurrence.endpoints.map((endpoint) => {
      const column = reference.slots.find(({ slot }) => slot.id === endpoint.columnSlotId)!;
      const row = reference.slots.find(({ slot }) => slot.id === endpoint.rowSlotId)!;
      const columnIndex = column.live ? column.index! + (endpoint.anchors.column ? 0 : target.columnIndex - origin.columnIndex) : undefined;
      const rowIndex = row.live ? row.index! + (endpoint.anchors.row ? 0 : target.rowIndex - origin.rowIndex) : undefined;
      const columnId = columnIndex === undefined ? undefined : sheet.content.columns[columnIndex];
      const rowId = rowIndex === undefined ? undefined : sheet.content.rows[rowIndex];
      const named = columnId && column.slot.kind === 'property' ? resolver.namedAddressAt?.(sheetId, { columnId, rowId: rowId ?? sheet.content.rows[0] }) : undefined;
      return { column, row, columnId, rowId, named };
    });
    if (endpoints.some(({ column, row, columnId, rowId }) => column.live && !columnId || row.live && !rowId)) return { ok: false, reason: 'unresolved-coordinate' };
    const useNamed = endpoints.length === 1 || endpoints.every(({ column, named }) => !column.live || named);
    // A dead property cannot be converted to an A1 column without discarding its retained pair.
    if (!useNamed && endpoints.some(({ column }) => !column.live && column.slot.kind === 'property')) return { ok: false, reason: 'unresolved-coordinate' };
    transform.sheet(reference, sheetId, Boolean(reference.lexeme.qualifier));
    endpoints.forEach(({ column, row, columnId, rowId, named }, index) => {
      const property = useNamed && named ? named : undefined;
      if (column.live) transform.column(reference, index, sheetId, columnId!, property);
      if (row.live || column.live && !property) transform.row(reference, index, sheetId, rowId, column.live && !property);
    });
  }
  return { ok: true, content: transform.finish() };
}
