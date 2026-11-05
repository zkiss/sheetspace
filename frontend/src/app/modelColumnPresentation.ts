import { calculatedOwnedColumns } from '@workbook/core/calculatedOwnership';
import type { SheetDocument, Workbook } from '@workbook/core/model';
import { findSheetById } from '@workbook/read/queries';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { projectSelection } from '@workbook/read/selection';

/**
 * Live model presentation of a bound sheet.
 *
 * The current property names and the calculated columns follow the sheet's model
 * declaration and its stable property-to-column bindings, never the displayed text.
 */
export function modelColumnPresentation(sheet: SheetDocument, models: Workbook['dataModels']) {
  const model = sheet.modelId ? models?.[sheet.modelId] : undefined;
  const columnLabels = new Map(Object.entries(sheet.columnNames ?? {}).filter(([id]) => sheet.content.columns.includes(id)));
  for (const [columnId, name] of model?.columns.flatMap((property) => {
    const columnId = sheet.modelColumnBindings?.[property.id];
    return columnId ? [[columnId, property.name] as const] : [];
  }) ?? []) columnLabels.set(columnId, name);
  const calculatedColumnIds = new Set(model?.columns.flatMap((property) => property.kind === 'calculated'
    ? [sheet.modelColumnBindings?.[property.id]].filter((columnId): columnId is string => Boolean(columnId))
    : []) ?? []);
  return { calculatedColumnIds, columnLabels };
}

/** True when the selection covers a column that the selected sheet's model calculates. */
export function selectionIncludesCalculatedColumn(workbook: Workbook, selection: CellSelection) {
  const sheet = findSheetById(workbook, selection.anchor.sheetId);
  const projection = sheet && projectSelection(sheet, selection);
  if (!sheet || !projection) return false;
  const calculatedColumns = calculatedOwnedColumns(sheet, workbook.dataModels);
  return projection.columns.some((columnId) => calculatedColumns.has(columnId));
}
