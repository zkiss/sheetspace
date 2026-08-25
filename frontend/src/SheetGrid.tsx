import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import {
  cellKey,
  parseA1Address,
  sheetBounds,
  type CellAddress,
  type CellRange,
  type FormulaEvaluationSnapshot,
  type SheetTabularProjection,
} from './workbook';
import type { GridAxisProjection } from './gridAxisProjection';
import {
  GRID_COLUMN_HEADER_HEIGHT,
  GRID_CELL_HEIGHT,
  GRID_CELL_WIDTH,
  GRID_ROW_HEADER_WIDTH,
  sheetContentOffsetForCell,
} from './gridGeometry';
import type { CellEditSession } from './appTypes';
import { cellKeyForTarget } from './cellInteraction';
import {
  SheetGridCell,
  type SheetGridCellEditorInteraction,
  type SheetGridCellInteraction,
} from './SheetGridCell';
import { SheetGridHeaders } from './SheetGridHeaders';
import { getSheetCellDisplayText } from './sheetGridModel';
import { cssRemFromPixels } from './styleTokens';
import './SheetGrid.css';

function ensureCellVisibleOutsideStickyHeaders(
  cell: HTMLTableCellElement,
  scrollContainer: HTMLElement,
  columnHeader: HTMLTableCellElement | null,
  rowHeader: HTMLTableCellElement | null,
) {
  cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const cellRect = cell.getBoundingClientRect();
  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  const visibleTop = scrollContainerRect.top
    + (columnHeader?.getBoundingClientRect().height ?? GRID_COLUMN_HEADER_HEIGHT);
  const visibleLeft = scrollContainerRect.left
    + (rowHeader?.getBoundingClientRect().width ?? GRID_ROW_HEADER_WIDTH);

  if (cellRect.top < visibleTop) {
    scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - (visibleTop - cellRect.top));
  }

  if (cellRect.left < visibleLeft) {
    scrollContainer.scrollLeft = Math.max(0, scrollContainer.scrollLeft - (visibleLeft - cellRect.left));
  }
}

export function SheetGrid({
  activeCellKey,
  axisProjection,
  cellInteraction,
  editorInteraction,
  editingCell,
  keyboardFocusCellKey,
  navigationHighlightCellKey,
  navigationHighlightRange,
  formulaResults,
  scrollContainerRef,
  sheet,
  selectedRange,
}: {
  activeCellKey: string | null;
  axisProjection: GridAxisProjection;
  cellInteraction: SheetGridCellInteraction;
  editorInteraction: SheetGridCellEditorInteraction;
  editingCell: CellEditSession | null;
  keyboardFocusCellKey: string | null;
  navigationHighlightCellKey: string | null;
  navigationHighlightRange?: CellRange;
  formulaResults: FormulaEvaluationSnapshot;
  scrollContainerRef: RefObject<HTMLElement>;
  sheet: SheetTabularProjection;
  selectedRange?: CellRange;
}) {
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const columnHeaderRef = useRef<HTMLTableCellElement>(null);
  const rowHeaderRef = useRef<HTMLTableCellElement>(null);
  const { columns, rows } = axisProjection;

  function registerCell(key: string, cellElement: HTMLTableCellElement | null) {
    if (cellElement) {
      cellRefs.current.set(key, cellElement);
    } else {
      cellRefs.current.delete(key);
    }
  }

  useEffect(() => {
    if (!activeCellKey || activeCellKey !== keyboardFocusCellKey || editingCell) {
      return;
    }

    const cell = cellRefs.current.get(activeCellKey);
    cell?.focus();
    if (cell && scrollContainerRef.current) {
      ensureCellVisibleOutsideStickyHeaders(
        cell,
        scrollContainerRef.current,
        columnHeaderRef.current,
        rowHeaderRef.current,
      );
    }
  }, [activeCellKey, editingCell, keyboardFocusCellKey, scrollContainerRef]);

  useEffect(() => {
    if (!navigationHighlightRange && !navigationHighlightCellKey) {
      return;
    }

    const parsedCell = navigationHighlightCellKey
      ? parseA1Address(navigationHighlightCellKey, sheetBounds(sheet))
      : undefined;
    const range = navigationHighlightRange
      ?? (parsedCell?.ok
        ? { start: parsedCell.value, end: parsedCell.value }
        : undefined);
    if (!range) {
      return;
    }

    const start = cellRefs.current.get(cellKey(range.start));
    const scrollContainer = scrollContainerRef.current;
    if (!start || !scrollContainer) {
      return;
    }

    const contentOffset = sheetContentOffsetForCell(range.start);
    scrollContainer.scrollLeft = contentOffset.x;
    scrollContainer.scrollTop = contentOffset.y;
  }, [navigationHighlightCellKey, navigationHighlightRange, scrollContainerRef, sheet]);

  return (
    <table
      aria-label={`${sheet.name} grid`}
      className="sheet-grid"
      data-testid="sheet-grid"
      style={{
        '--grid-cell-height': cssRemFromPixels(GRID_CELL_HEIGHT),
        '--grid-cell-width': cssRemFromPixels(GRID_CELL_WIDTH),
        '--grid-row-header-width': cssRemFromPixels(GRID_ROW_HEADER_WIDTH),
      } as CSSProperties}
    >
      <SheetGridHeaders columnHeaderRef={columnHeaderRef} columns={columns} />
      <tbody>
        {rows.map((row) => (
          <tr key={row.kind === 'creating' ? row.operationId : row.id}>
            <th
              aria-label={row.kind === 'creating' ? 'Creating row' : undefined}
              className={`sheet-grid-row-header${row.kind === 'creating' ? ' sheet-grid-axis-creating' : ''}`}
              ref={row.kind === 'saved' && row.durableIndex === 0 ? rowHeaderRef : undefined}
              scope="row"
            >
              {row.kind === 'creating' ? 'Creating…' : row.durableIndex + 1}
            </th>
            {columns.map((column) => {
              if (row.kind === 'creating' || column.kind === 'creating') {
                return (
                  <td
                    aria-label="Creating cell"
                    className="sheet-grid-cell sheet-grid-cell-creating"
                    key={column.kind === 'creating' ? column.operationId : column.id}
                  />
                );
              }
              const address = { columnIndex: column.durableIndex, rowIndex: row.durableIndex };
              const key = cellKey(address);
              const isActive = activeCellKey === key;
              const isEditing = cellKeyForTarget(sheet, editingCell?.target ?? null) === key;
              const isRangeSelected = isAddressInRange(address, selectedRange);
              const isNavigationTarget = navigationHighlightRange
                ? isAddressInRange(address, navigationHighlightRange)
                : navigationHighlightCellKey === key;

              return (
                <SheetGridCell
                  cellKey={key}
                  displayText={getSheetCellDisplayText({ cellKey: key, formulaResults, sheet })}
                  editingCell={editingCell}
                  cellInteraction={cellInteraction}
                  editorInteraction={editorInteraction}
                  isActive={isActive}
                  isEditing={isEditing}
                  isNavigationTarget={isNavigationTarget}
                  isRangeSelected={isRangeSelected}
                  key={key}
                  registerCell={registerCell}
                  sheet={sheet}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function isAddressInRange(address: CellAddress, range?: CellRange) {
  return Boolean(
    range
      && address.columnIndex >= range.start.columnIndex
      && address.columnIndex <= range.end.columnIndex
      && address.rowIndex >= range.start.rowIndex
      && address.rowIndex <= range.end.rowIndex,
  );
}
