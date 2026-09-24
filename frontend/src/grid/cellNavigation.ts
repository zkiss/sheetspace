import { cellAddressOf, cellIdentityFromKey, cellIdentityKey } from '@workbook/core/cellIdentity';
import type { SheetDocument } from '@workbook/core/model';
import type { CellNavigationDirection, CellNavigationRequest, CellSelection, CellTarget } from './cellInteractionContracts';

type Address = { rowIndex: number; columnIndex: number };

const directionForKey: Partial<Record<CellNavigationRequest['key'], CellNavigationDirection>> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
};

/**
 * Resolves spreadsheet keyboard destinations from stable sheet axes and raw
 * cell occupancy. It has no React or content-command dependency, so callers
 * can safely use it for focus and selection state only.
 */
export function resolveCellNavigation(
  sheet: SheetDocument,
  target: CellTarget,
  selection: CellSelection | null,
  request: CellNavigationRequest,
): CellTarget | undefined {
  if (request.alt || target.sheetId !== sheet.id) return undefined;
  const address = cellAddressOf(sheet.content, target.cell);
  if (!address || sheet.content.rows.length === 0 || sheet.content.columns.length === 0) return undefined;

  const direction = directionForKey[request.key];
  if (direction) return targetAt(sheet, request.command ? commandArrowTarget(sheet, address, direction) : adjacent(address, direction, sheet));
  if (request.key === 'Home') return targetAt(sheet, request.command ? { rowIndex: 0, columnIndex: 0 } : { ...address, columnIndex: 0 });
  if (request.key === 'End') return targetAt(sheet, request.command ? usedExtentEnd(sheet) : rowEnd(sheet, address.rowIndex));
  if (request.key === 'Tab' || request.key === 'Enter') {
    return targetAt(sheet, rangeTraversalTarget(sheet, address, selection, request.key, Boolean(request.shift)));
  }
  return undefined;
}

function targetAt(sheet: SheetDocument, address: Address): CellTarget | undefined {
  const rowId = sheet.content.rows[address.rowIndex];
  const columnId = sheet.content.columns[address.columnIndex];
  return rowId === undefined || columnId === undefined ? undefined : { sheetId: sheet.id, cell: { rowId, columnId } };
}

function adjacent(address: Address, direction: CellNavigationDirection, sheet: SheetDocument): Address {
  const delta = directionDelta(direction);
  return {
    rowIndex: Math.max(0, Math.min(sheet.content.rows.length - 1, address.rowIndex + delta.rowIndex)),
    columnIndex: Math.max(0, Math.min(sheet.content.columns.length - 1, address.columnIndex + delta.columnIndex)),
  };
}

function commandArrowTarget(sheet: SheetDocument, start: Address, direction: CellNavigationDirection): Address {
  const delta = directionDelta(direction);
  const next = { rowIndex: start.rowIndex + delta.rowIndex, columnIndex: start.columnIndex + delta.columnIndex };
  if (!inBounds(sheet, next)) return start;

  // Within a populated run, Ctrl/Cmd stops at its far boundary. From a blank
  // cell, or a populated boundary followed by blanks, it seeks the next filled
  // cell and otherwise reaches the relevant grid edge.
  if (occupied(sheet, start) && occupied(sheet, next)) {
    let cursor = next;
    while (inBounds(sheet, step(cursor, delta)) && occupied(sheet, step(cursor, delta))) cursor = step(cursor, delta);
    return cursor;
  }
  let cursor = next;
  while (inBounds(sheet, cursor) && !occupied(sheet, cursor)) cursor = step(cursor, delta);
  return inBounds(sheet, cursor) ? cursor : edge(sheet, start, direction);
}

function rowEnd(sheet: SheetDocument, rowIndex: number): Address {
  for (let columnIndex = sheet.content.columns.length - 1; columnIndex >= 0; columnIndex -= 1) {
    if (occupied(sheet, { rowIndex, columnIndex })) return { rowIndex, columnIndex };
  }
  return { rowIndex, columnIndex: sheet.content.columns.length - 1 };
}

function usedExtentEnd(sheet: SheetDocument): Address {
  let maxRow = -1;
  let maxColumn = -1;
  for (const [key, raw] of Object.entries(sheet.content.cells)) {
    if (raw === '') continue;
    const identity = cellIdentityFromKey(key);
    const address = identity && cellAddressOf(sheet.content, identity);
    if (!address) continue;
    maxRow = Math.max(maxRow, address.rowIndex);
    maxColumn = Math.max(maxColumn, address.columnIndex);
  }
  return maxRow < 0 || maxColumn < 0 ? { rowIndex: 0, columnIndex: 0 } : { rowIndex: maxRow, columnIndex: maxColumn };
}

function rangeTraversalTarget(
  sheet: SheetDocument,
  active: Address,
  selection: CellSelection | null,
  key: 'Tab' | 'Enter',
  reverse: boolean,
): Address {
  const range = selection?.mode === 'cells' && selection.anchor.sheetId === sheet.id && selection.extent.sheetId === sheet.id
    ? rangeAddresses(sheet, selection)
    : undefined;
  if (!range || (range.start.rowIndex === range.end.rowIndex && range.start.columnIndex === range.end.columnIndex)) {
    const direction: CellNavigationDirection = key === 'Tab'
      ? (reverse ? 'left' : 'right')
      : (reverse ? 'up' : 'down');
    return adjacent(active, direction, sheet);
  }
  const stepAmount = reverse ? -1 : 1;
  if (key === 'Tab') {
    const nextColumn = active.columnIndex + stepAmount;
    if (nextColumn >= range.start.columnIndex && nextColumn <= range.end.columnIndex) return { ...active, columnIndex: nextColumn };
    const nextRow = active.rowIndex + stepAmount;
    return { rowIndex: nextRow < range.start.rowIndex ? range.end.rowIndex : nextRow > range.end.rowIndex ? range.start.rowIndex : nextRow, columnIndex: reverse ? range.end.columnIndex : range.start.columnIndex };
  }
  const nextRow = active.rowIndex + stepAmount;
  if (nextRow >= range.start.rowIndex && nextRow <= range.end.rowIndex) return { ...active, rowIndex: nextRow };
  const nextColumn = active.columnIndex + stepAmount;
  return { rowIndex: reverse ? range.end.rowIndex : range.start.rowIndex, columnIndex: nextColumn < range.start.columnIndex ? range.end.columnIndex : nextColumn > range.end.columnIndex ? range.start.columnIndex : nextColumn };
}

function rangeAddresses(sheet: SheetDocument, selection: CellSelection): { start: Address; end: Address } | undefined {
  const anchor = cellAddressOf(sheet.content, selection.anchor.cell);
  const extent = cellAddressOf(sheet.content, selection.extent.cell);
  if (!anchor || !extent) return undefined;
  return {
    start: { rowIndex: Math.min(anchor.rowIndex, extent.rowIndex), columnIndex: Math.min(anchor.columnIndex, extent.columnIndex) },
    end: { rowIndex: Math.max(anchor.rowIndex, extent.rowIndex), columnIndex: Math.max(anchor.columnIndex, extent.columnIndex) },
  };
}

function occupied(sheet: SheetDocument, address: Address) {
  const rowId = sheet.content.rows[address.rowIndex];
  const columnId = sheet.content.columns[address.columnIndex];
  const raw = rowId !== undefined && columnId !== undefined
    ? sheet.content.cells[cellIdentityKey({ rowId, columnId })]
    : undefined;
  return raw !== undefined && raw !== '';
}

function directionDelta(direction: CellNavigationDirection) {
  return ({ left: { rowIndex: 0, columnIndex: -1 }, right: { rowIndex: 0, columnIndex: 1 }, up: { rowIndex: -1, columnIndex: 0 }, down: { rowIndex: 1, columnIndex: 0 } })[direction];
}
function step(address: Address, delta: Address): Address { return { rowIndex: address.rowIndex + delta.rowIndex, columnIndex: address.columnIndex + delta.columnIndex }; }
function inBounds(sheet: SheetDocument, address: Address) { return address.rowIndex >= 0 && address.rowIndex < sheet.content.rows.length && address.columnIndex >= 0 && address.columnIndex < sheet.content.columns.length; }
function edge(sheet: SheetDocument, start: Address, direction: CellNavigationDirection): Address {
  return direction === 'left' ? { ...start, columnIndex: 0 }
    : direction === 'right' ? { ...start, columnIndex: sheet.content.columns.length - 1 }
      : direction === 'up' ? { ...start, rowIndex: 0 }
        : { ...start, rowIndex: sheet.content.rows.length - 1 };
}
