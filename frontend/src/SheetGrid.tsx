import { useEffect, useRef } from 'react';
import {
  cellKey,
  columnIndexToLabel,
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
}: {
  activeCellKey: string | null;
  editingCell: EditingCell | null;
  keyboardFocusCellKey: string | null;
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

              return (
                <SheetGridCell
                  cellKey={key}
                  displayText={getSheetCellDisplayText({ cellKey: key, formulaResults, sheet })}
                  editingCell={editingCell}
                  isActive={isActive}
                  isEditing={isEditing}
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
