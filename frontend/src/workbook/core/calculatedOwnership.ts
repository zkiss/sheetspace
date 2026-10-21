import type { ColumnId, SheetDocument, Workbook } from './model';

/**
 * Columns owned by the calculated properties of a sheet's current model declaration.
 *
 * Ownership follows the live declaration and the stable property-to-column bindings, never
 * the displayed raw text. A reordered declaration, an edited formula, a changed property
 * kind or a rebound sheet therefore moves ownership with the declaration.
 */
export function calculatedOwnedColumns(sheet: SheetDocument, models: Workbook['dataModels']): ReadonlySet<ColumnId> {
  const model = sheet.modelId === undefined ? undefined : models?.[sheet.modelId];
  if (!model) return new Set<ColumnId>();
  const owned = new Set<ColumnId>();
  for (const property of model.columns) {
    if (property.kind !== 'calculated') continue;
    const columnId = sheet.modelColumnBindings?.[property.id];
    if (columnId !== undefined) owned.add(columnId);
  }
  return owned;
}

/** True when that column of that sheet belongs to a calculated property of its current model. */
export function isCalculatedOwnedColumn(workbook: Workbook, sheetId: string, columnId: ColumnId): boolean {
  const sheet = workbook.documents[sheetId];
  return sheet !== undefined && calculatedOwnedColumns(sheet, workbook.dataModels).has(columnId);
}
