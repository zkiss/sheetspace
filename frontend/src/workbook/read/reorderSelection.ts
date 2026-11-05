import type { SheetDocument } from '@workbook/core/model';
import { projectSelection, type Selection, type SelectionTarget } from './selection';

export function reorderSelection(
  sheet: SheetDocument, selection: Selection | null, focus: SelectionTarget | null, axis: 'row' | 'column',
): readonly string[] {
  if (!focus || focus.sheetId !== sheet.id) return [];
  const order = axis === 'row' ? sheet.content.rows : sheet.content.columns;
  const focusedId = axis === 'row' ? focus.cell.rowId : focus.cell.columnId;
  if (!order.includes(focusedId) || !sheet.content.rows.includes(focus.cell.rowId) || !sheet.content.columns.includes(focus.cell.columnId)) return [];
  if (axis === 'column' && sheet.modelId) return [];
  if (!selection) return [focusedId];
  const projection = projectSelection(sheet, selection);
  if (!projection) return [];
  if ((selection.mode === 'rows' && axis === 'column') || (selection.mode === 'columns' && axis === 'row')) return [focusedId];
  return axis === 'row' ? projection.rows : projection.columns;
}
