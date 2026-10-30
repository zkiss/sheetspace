import type { Workbook } from '../core/model';
import { namedColumns } from '../core/columnNames';
import { projectRenamedModelFormulas } from '../formula/renamedModelFormulas';

export function renameOrdinaryColumn(workbook: Workbook, sheetId: string, columnId: string, input: string):
  | { ok: true; value: Workbook }
  | { ok: false; reason: 'unknown-sheet' | 'unknown-column' | 'model-column' | 'empty' | 'duplicate' } {
  const sheet = workbook.documents[sheetId];
  if (!sheet) return { ok: false, reason: 'unknown-sheet' };
  if (!sheet.content.columns.includes(columnId)) return { ok: false, reason: 'unknown-column' };
  if (Object.values(sheet.modelColumnBindings ?? {}).includes(columnId)) return { ok: false, reason: 'model-column' };
  const name = input.trim();
  if (!name) return { ok: false, reason: 'empty' };
  if (namedColumns(workbook, sheet).some((column) => column.columnId !== columnId && column.name === name)) return { ok: false, reason: 'duplicate' };
  if (sheet.columnNames?.[columnId] === name) return { ok: true, value: workbook };
  return { ok: true, value: projectRenamedModelFormulas(workbook, { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, columnNames: { ...sheet.columnNames, [columnId]: name } } } }) };
}
