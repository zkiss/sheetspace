import type { SheetDocument, Workbook } from './model';

export function namedColumns(workbook: Workbook, sheet: SheetDocument): { id: string; columnId: string; name: string }[] {
  const model = sheet.modelId ? workbook.dataModels?.[sheet.modelId] : undefined;
  const properties = (model?.columns ?? []).flatMap((property) => {
    const columnId = sheet.modelColumnBindings?.[property.id];
    return columnId && sheet.content.columns.includes(columnId) ? [{ id: property.id, columnId, name: property.name }] : [];
  });
  return [...properties, ...Object.entries(sheet.columnNames ?? {}).flatMap(([columnId, name]) =>
    sheet.content.columns.includes(columnId) && !properties.some((property) => property.columnId === columnId)
      ? [{ id: columnId, columnId, name }] : [])];
}

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
  return { ok: true, value: { ...workbook, documents: { ...workbook.documents, [sheetId]: { ...sheet, columnNames: { ...sheet.columnNames, [columnId]: name } } } } };
}
