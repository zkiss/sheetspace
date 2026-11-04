import type { SheetDocument } from '@workbook/core/model';

export type SelectionTarget = { sheetId: string; cell: { rowId: string; columnId: string } };
export type Selection = {
  mode: 'cells' | 'rows' | 'columns';
  anchor: SelectionTarget;
  extent: SelectionTarget;
  members?: readonly string[];
};
export type AxisSelection = Selection & { mode: 'rows' | 'columns'; members: readonly string[] };
type Sheet = Pick<SheetDocument, 'id' | 'content'>;
type Run = { start: number; end: number };
export type SelectionProjection = {
  rows: readonly string[];
  columns: readonly string[];
  rowRuns: Run[];
  columnRuns: Run[];
  bounds: { rowStart: number; rowEnd: number; columnStart: number; columnEnd: number };
  rectangular: boolean;
};

function runs(indices: number[]): Run[] {
  const result: Run[] = [];
  for (const index of indices) {
    const last = result[result.length - 1];
    if (last && last.end + 1 === index) last.end = index;
    else result.push({ start: index, end: index });
  }
  return result;
}

function axes(sheet: Sheet, selection: Selection) {
  if (selection.anchor.sheetId !== sheet.id || selection.extent.sheetId !== sheet.id ||
      !['cells', 'rows', 'columns'].includes(selection.mode)) return undefined;
  const rows = sheet.content.rows;
  const columns = sheet.content.columns;
  if (!rows.length || !columns.length || new Set(rows).size !== rows.length || new Set(columns).size !== columns.length) return undefined;
  return { rows, columns };
}

export function projectSelection(sheet: Sheet, selection: Selection): SelectionProjection | undefined {
  const order = axes(sheet, selection);
  if (!order) return undefined;
  const ar = order.rows.indexOf(selection.anchor.cell.rowId);
  const er = order.rows.indexOf(selection.extent.cell.rowId);
  const ac = order.columns.indexOf(selection.anchor.cell.columnId);
  const ec = order.columns.indexOf(selection.extent.cell.columnId);
  if ([ar, er, ac, ec].some((index) => index < 0)) return undefined;
  if (selection.mode === 'cells' && selection.members !== undefined) return undefined;
  const selectedOrder = selection.mode === 'rows' ? order.rows : order.columns;
  if (selection.members && (selection.members.length === 0 || new Set(selection.members).size !== selection.members.length ||
      selection.members.some((id) => !selectedOrder.includes(id)) ||
      !selection.members.includes(selection.mode === 'rows' ? selection.anchor.cell.rowId : selection.anchor.cell.columnId) ||
      !selection.members.includes(selection.mode === 'rows' ? selection.extent.cell.rowId : selection.extent.cell.columnId))) return undefined;
  const selected = new Set(selection.members);
  const rowIndices = order.rows.flatMap((id, i) => (selection.mode === 'columns' || (selection.mode === 'rows' && selection.members ? selected.has(id) : i >= Math.min(ar, er) && i <= Math.max(ar, er))) ? [i] : []);
  const columnIndices = order.columns.flatMap((id, i) => (selection.mode === 'rows' || (selection.mode === 'columns' && selection.members ? selected.has(id) : i >= Math.min(ac, ec) && i <= Math.max(ac, ec))) ? [i] : []);
  const rowRuns = runs(rowIndices);
  const columnRuns = runs(columnIndices);
  return {
    rows: rowIndices.map((i) => order.rows[i]!), columns: columnIndices.map((i) => order.columns[i]!), rowRuns, columnRuns,
    bounds: { rowStart: rowIndices[0]!, rowEnd: rowIndices[rowIndices.length - 1]!, columnStart: columnIndices[0]!, columnEnd: columnIndices[columnIndices.length - 1]! },
    rectangular: rowRuns.length === 1 && columnRuns.length === 1,
  };
}

export function pruneAxisSelection(sheet: Sheet, selection: AxisSelection): AxisSelection | undefined {
  const order = axes(sheet, selection);
  if (!order || (selection.mode !== 'rows' && selection.mode !== 'columns') || !selection.members.length || new Set(selection.members).size !== selection.members.length) return undefined;
  const axis = selection.mode === 'rows' ? order.rows : order.columns;
  const members = axis.filter((id) => selection.members.includes(id));
  if (!members.length) return undefined;
  const fix = (target: SelectionTarget): SelectionTarget => ({ sheetId: sheet.id, cell: {
    rowId: selection.mode === 'rows' ? (members.includes(target.cell.rowId) ? target.cell.rowId : members[0]!) : (order.rows.includes(target.cell.rowId) ? target.cell.rowId : order.rows[0]!),
    columnId: selection.mode === 'columns' ? (members.includes(target.cell.columnId) ? target.cell.columnId : members[0]!) : (order.columns.includes(target.cell.columnId) ? target.cell.columnId : order.columns[0]!),
  } });
  return { ...selection, members, anchor: fix(selection.anchor), extent: fix(selection.extent) };
}

export function toggleAxisMember(sheet: Sheet, selection: AxisSelection, id: string): AxisSelection | undefined {
  const current = pruneAxisSelection(sheet, selection);
  if (!current || !projectSelection(sheet, selection)) return undefined;
  const axis = current.mode === 'rows' ? sheet.content.rows : sheet.content.columns;
  if (!axis.includes(id)) return undefined;
  const members = current.members.includes(id) ? current.members.filter((member) => member !== id) : [...current.members, id];
  return pruneAxisSelection(sheet, { ...current, members });
}

export function extendAxisSelection(sheet: Sheet, selection: AxisSelection, id: string): AxisSelection | undefined {
  if (!projectSelection(sheet, selection)) return undefined;
  const axis = selection.mode === 'rows' ? sheet.content.rows : sheet.content.columns;
  const anchor = selection.mode === 'rows' ? selection.anchor.cell.rowId : selection.anchor.cell.columnId;
  const start = axis.indexOf(anchor);
  const end = axis.indexOf(id);
  if (end < 0) return undefined;
  const cell = selection.mode === 'rows' ? { ...selection.extent.cell, rowId: id } : { ...selection.extent.cell, columnId: id };
  return { ...selection, extent: { sheetId: sheet.id, cell }, members: axis.slice(Math.min(start, end), Math.max(start, end) + 1) };
}
