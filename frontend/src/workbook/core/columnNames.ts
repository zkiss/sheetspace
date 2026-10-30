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

