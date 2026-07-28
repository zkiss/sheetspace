import { useEffect, useRef } from 'react';
import {
  cellKey,
  columnIndexToLabel,
  type CellAddress,
  type CellRange,
  type FormulaEvaluationSnapshot,
  type Sheet,
} from './workbook';
import type { ActiveCellSelection, CellNavigationDirection, EditingCell } from './appTypes';
import { SheetGridCell } from './SheetGridCell';
import { SheetGridHeaders } from './SheetGridHeaders';
import { getSheetCellDisplayText, type ColumnHeader } from './sheetGridModel';

function ensureCellVisibleOutsideStickyHeaders(cell: HTMLTableCellElement) {
  const scrollContainer = cell.closest<HTMLElement>('.sheet-frame-body');

  cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });

  if (!scrollContainer) {
    return;
  }

  const columnHeader = scrollContainer.querySelector<HTMLElement>('.sheet-grid-column-header');
  const rowHeader = scrollContainer.querySelector<HTMLElement>('.sheet-grid-row-header');
  const cellRect = cell.getBoundingClientRect();
  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  const columnHeaderHeight = columnHeader?.getBoundingClientRect().height ?? 0;
  const rowHeaderWidth = rowHeader?.getBoundingClientRect().width ?? 0;
  const visibleTop = scrollContainerRect.top + columnHeaderHeight;
  const visibleLeft = scrollContainerRect.left + rowHeaderWidth;

  if (cellRect.top < visibleTop) {
    scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - (visibleTop - cellRect.top));
  }

  if (cellRect.left < visibleLeft) {
    scrollContainer.scrollLeft = Math.max(0, scrollContainer.scrollLeft - (visibleLeft - cellRect.left));
  }
}

export function SheetGrid({
  activeCellKey,
  editingCell,
  keyboardFocusCellKey,
  navigationHighlightCellKey,
  navigationHighlightRange,
  onCancelEdit,
  onClearCell,
  onCommitEdit,
  onCommitEditAndNavigate,
  onEditValueChange,
  onNavigateCell,
  onSelectCell,
  onStartEdit,
  formulaResults,
  sheet,
  selectedRange,
}: {
  activeCellKey: string | null;
  editingCell: EditingCell | null;
  keyboardFocusCellKey: string | null;
  navigationHighlightCellKey: string | null;
  navigationHighlightRange?: CellRange;
  onCancelEdit: () => void;
  onClearCell: (selection: ActiveCellSelection) => void;
  onCommitEdit: (editToCommit?: EditingCell) => void;
  onCommitEditAndNavigate: (editToCommit: EditingCell, direction: 'tab' | 'enter') => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (sheet: Sheet, cellKey: string, direction: CellNavigationDirection) => void;
  onSelectCell: (selection: ActiveCellSelection) => void;
  onStartEdit: (selection: ActiveCellSelection, initialValue?: string) => void;
  formulaResults: FormulaEvaluationSnapshot;
  sheet: Sheet;
  selectedRange?: CellRange;
}) {
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const columns: ColumnHeader[] = Array.from({ length: sheet.columnCount }, (_, columnIndex) => ({
    index: columnIndex,
    label: columnIndexToLabel(columnIndex),
  }));
  const rows = Array.from({ length: sheet.rowCount }, (_, rowIndex) => rowIndex);

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
    if (cell) {
      ensureCellVisibleOutsideStickyHeaders(cell);
    }
  }, [activeCellKey, editingCell, keyboardFocusCellKey]);

  useEffect(() => {
    if (!selectedRange) {
      return;
    }

    const start = cellRefs.current.get(cellKey(selectedRange.start));
    const end = cellRefs.current.get(cellKey(selectedRange.end));
    const scrollContainer = start?.closest<HTMLElement>('.sheet-frame-body');
    if (!start || !end || !scrollContainer) {
      return;
    }

    start.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const startRect = start.getBoundingClientRect();
    const endRect = end.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const columnHeader = scrollContainer.querySelector<HTMLElement>('.sheet-grid-column-header');
    const rowHeader = scrollContainer.querySelector<HTMLElement>('.sheet-grid-row-header');
    const visibleTop = containerRect.top + (columnHeader?.getBoundingClientRect().height ?? 0);
    const visibleLeft = containerRect.left + (rowHeader?.getBoundingClientRect().width ?? 0);
    const visibleWidth = containerRect.right - visibleLeft;
    const visibleHeight = containerRect.bottom - visibleTop;
    const rangeWidth = endRect.right - startRect.left;
    const rangeHeight = endRect.bottom - startRect.top;

    if (rangeWidth <= visibleWidth && endRect.right > containerRect.right) {
      scrollContainer.scrollLeft += endRect.right - containerRect.right;
    }
    if (rangeHeight <= visibleHeight && endRect.bottom > containerRect.bottom) {
      scrollContainer.scrollTop += endRect.bottom - containerRect.bottom;
    }
  }, [selectedRange]);

  return (
    <table aria-label={`${sheet.name} grid`} className="sheet-grid" data-testid="sheet-grid">
      <SheetGridHeaders columns={columns} />
      <tbody>
        {rows.map((rowIndex) => (
          <tr key={rowIndex}>
            <th className="sheet-grid-row-header" scope="row">
              {rowIndex + 1}
            </th>
            {columns.map((column) => {
              const address = { columnIndex: column.index, rowIndex };
              const key = cellKey(address);
              const isActive = activeCellKey === key;
              const isEditing = editingCell?.cellKey === key;
              const isRangeSelected = isAddressInRange(address, selectedRange);
              const isNavigationTarget = navigationHighlightRange
                ? isAddressInRange(address, navigationHighlightRange)
                : navigationHighlightCellKey === key;

              return (
                <SheetGridCell
                  cellKey={key}
                  displayText={getSheetCellDisplayText({ cellKey: key, formulaResults, sheet })}
                  editingCell={editingCell}
                  isActive={isActive}
                  isEditing={isEditing}
                  isNavigationTarget={isNavigationTarget}
                  isRangeSelected={isRangeSelected}
                  key={key}
                  onCancelEdit={onCancelEdit}
                  onClearCell={onClearCell}
                  onCommitEdit={onCommitEdit}
                  onCommitEditAndNavigate={onCommitEditAndNavigate}
                  onEditValueChange={onEditValueChange}
                  onNavigateCell={onNavigateCell}
                  onSelectCell={onSelectCell}
                  onStartEdit={onStartEdit}
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
