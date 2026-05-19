import { KeyboardEvent, useEffect, useRef } from 'react';
import {
  cellKey,
  columnIndexToLabel,
  type FormulaEvaluationSnapshot,
  type Sheet,
} from './workbook';
import type { ActiveCellSelection, CellNavigationDirection, EditingCell } from './appTypes';

function moveEditorCaretToEnd(editor: HTMLTextAreaElement | null) {
  if (!editor) {
    return;
  }

  const end = editor.value.length;
  editor.setSelectionRange(end, end);
}

export function SheetGrid({
  activeCell,
  editingCell,
  keyboardFocusTarget,
  onCancelEdit,
  onCommitEdit,
  onCommitEditAndNavigate,
  onEditValueChange,
  onNavigateCell,
  onSelectCell,
  onStartEdit,
  formulaResults,
  sheet,
}: {
  activeCell: ActiveCellSelection | null;
  editingCell: EditingCell | null;
  keyboardFocusTarget: ActiveCellSelection | null;
  onCancelEdit: () => void;
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
  const columns = Array.from({ length: sheet.columnCount }, (_, columnIndex) => ({
    index: columnIndex,
    label: columnIndexToLabel(columnIndex),
  }));
  const rows = Array.from({ length: sheet.rowCount }, (_, rowIndex) => rowIndex);

  useEffect(() => {
    if (
      activeCell?.sheetId !== sheet.id ||
      activeCell.cellKey !== keyboardFocusTarget?.cellKey ||
      keyboardFocusTarget.sheetId !== sheet.id ||
      editingCell?.sheetId === sheet.id
    ) {
      return;
    }

    const cell = cellRefs.current.get(activeCell.cellKey);
    cell?.focus();
    cell?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeCell, editingCell?.sheetId, keyboardFocusTarget, sheet.id]);

  return (
    <table aria-label={`${sheet.name} grid`} className="sheet-grid" data-testid="sheet-grid">
      <thead>
        <tr>
          <th aria-label="Grid corner" className="sheet-grid-corner" scope="col" />
          {columns.map((column) => (
            <th className="sheet-grid-column-header" key={column.index} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((rowIndex) => (
          <tr key={rowIndex}>
            <th className="sheet-grid-row-header" scope="row">
              {rowIndex + 1}
            </th>
            {columns.map((column) => {
              const address = { columnIndex: column.index, rowIndex };
              const key = cellKey(address);
              const cell = sheet.cells[key];
              const isActive = activeCell?.sheetId === sheet.id && activeCell.cellKey === key;
              const isEditing = editingCell?.sheetId === sheet.id && editingCell.cellKey === key;
              const displayText = formulaResults[sheet.id]?.[key]?.display ?? cell?.raw ?? '';

              function handleCellKeyDown(event: KeyboardEvent<HTMLTableCellElement>) {
                if (event.target !== event.currentTarget) {
                  return;
                }

                if (!isActive || event.altKey || event.ctrlKey || event.metaKey) {
                  return;
                }

                if (event.key === 'Enter') {
                  event.preventDefault();
                  onStartEdit({ sheetId: sheet.id, cellKey: key });
                  return;
                }

                if (event.key === 'F2') {
                  event.preventDefault();
                  onStartEdit({ sheetId: sheet.id, cellKey: key });
                  return;
                }

                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  onNavigateCell(sheet, key, 'left');
                  return;
                }

                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  onNavigateCell(sheet, key, 'right');
                  return;
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  onNavigateCell(sheet, key, 'up');
                  return;
                }

                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  onNavigateCell(sheet, key, 'down');
                  return;
                }

                if (event.key === 'Backspace' || event.key === 'Delete') {
                  event.preventDefault();
                  onStartEdit({ sheetId: sheet.id, cellKey: key }, '');
                  return;
                }

                if (event.key.length === 1) {
                  event.preventDefault();
                  onStartEdit({ sheetId: sheet.id, cellKey: key }, event.key);
                }
              }

              return (
                <td
                  aria-label={`${sheet.name} ${key}${cell ? '' : ' empty'} cell`}
                  className={`sheet-grid-cell${isActive ? ' sheet-grid-cell-active' : ''}${
                    isEditing ? ' sheet-grid-cell-editing' : ''
                  }`}
                  data-active-cell={isActive ? 'true' : undefined}
                  data-cell-key={key}
                  data-editing-cell={isEditing ? 'true' : undefined}
                  data-testid="sheet-grid-cell"
                  key={key}
                  onClick={() => onSelectCell({ sheetId: sheet.id, cellKey: key })}
                  onDoubleClick={() => onStartEdit({ sheetId: sheet.id, cellKey: key })}
                  onFocus={() => onSelectCell({ sheetId: sheet.id, cellKey: key })}
                  onKeyDown={handleCellKeyDown}
                  ref={(cellElement) => {
                    if (cellElement) {
                      cellRefs.current.set(key, cellElement);
                    } else {
                      cellRefs.current.delete(key);
                    }
                  }}
                  tabIndex={0}
                >
                  {isEditing ? (
                    <textarea
                      aria-label={`${sheet.name} ${key} editor`}
                      autoFocus
                      className="sheet-grid-cell-editor"
                      onBlur={(event) => onCommitEdit({ ...editingCell, value: event.currentTarget.value })}
                      onChange={(event) => onEditValueChange(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          event.stopPropagation();
                          onCommitEditAndNavigate({ ...editingCell, value: event.currentTarget.value }, 'enter');
                        }

                        if (event.key === 'Tab' && !event.shiftKey) {
                          event.preventDefault();
                          event.stopPropagation();
                          onCommitEditAndNavigate({ ...editingCell, value: event.currentTarget.value }, 'tab');
                        }

                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          onCancelEdit();
                        }
                      }}
                      ref={moveEditorCaretToEnd}
                      value={editingCell.value}
                    />
                  ) : (
                    displayText
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
