import { calculatedOwnedColumns } from '@workbook/core/calculatedOwnership';
import type { SheetDocument, Workbook } from '@workbook/core/model';
import { findSheetById } from '@workbook/read/queries';
import type { CellSelection } from '@grid/cellInteractionContracts';
import { selectionAddressRange } from './workspaceSelection';

/**
 * Live model presentation of a bound sheet.
 *
 * The current property names and the calculated columns follow the sheet's model
 * declaration and its stable property-to-column bindings, never the displayed text.
 */
export function modelColumnPresentation(sheet: SheetDocument, models: Workbook['dataModels']) {
  const model = sheet.modelId ? models?.[sheet.modelId] : undefined;
  const columnLabels = new Map(model?.columns.flatMap((property) => {
    const columnId = sheet.modelColumnBindings?.[property.id];
    return columnId ? [[columnId, property.name] as const] : [];
  }) ?? []);
  const calculatedColumnIds = new Set(model?.columns.flatMap((property) => property.kind === 'calculated'
    ? [sheet.modelColumnBindings?.[property.id]].filter((columnId): columnId is string => Boolean(columnId))
    : []) ?? []);
  return { calculatedColumnIds, columnLabels };
}

/** True when the selection covers a column that the selected sheet's model calculates. */
export function selectionIncludesCalculatedColumn(workbook: Workbook, selection: CellSelection) {
  const sheet = findSheetById(workbook, selection.anchor.sheetId);
  const range = sheet && selectionAddressRange(sheet, selection);
  if (!sheet || !range) return false;
  const calculatedColumns = calculatedOwnedColumns(sheet, workbook.dataModels);
  return sheet.content.columns.slice(range.start.columnIndex, range.end.columnIndex + 1)
    .some((columnId) => calculatedColumns.has(columnId));
}
