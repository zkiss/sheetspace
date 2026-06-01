import { KeyboardEvent } from 'react';
import type { Sheet } from './workbook';
import type { ActiveCellSelection, CellNavigationDirection, EditingCell } from './appTypes';
import { gridCellKeyboardAction } from './sheetGridModel';

export const CELL_EDITOR_MAX_WIDTH = '28rem';
export const CELL_EDITOR_MAX_HEIGHT = '12rem';

function moveEditorCaretToEnd(editor: HTMLTextAreaElement | null) {
  if (!editor) {
    return;
  }

  const end = editor.value.length;
  editor.setSelectionRange(end, end);
}

export function SheetGridCell({
  cellKey,
  displayText,
  editingCell,
  isActive,
  isEditing,
  onCancelEdit,
  onClearCell,
  onCommitEdit,
  onCommitEditAndNavigate,
  onEditValueChange,
  onNavigateCell,
  onSelectCell,
  onStartEdit,
  registerCell,
  sheet,
}: {
  cellKey: string;
  displayText: string;
  editingCell: EditingCell | null;
  isActive: boolean;
  isEditing: boolean;
  onCancelEdit: () => void;
  onClearCell: (selection: ActiveCellSelection) => void;
  onCommitEdit: (editToCommit?: EditingCell) => void;
  onCommitEditAndNavigate: (editToCommit: EditingCell, direction: 'tab' | 'enter') => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (sheet: Sheet, cellKey: string, direction: CellNavigationDirection) => void;
  onSelectCell: (selection: ActiveCellSelection) => void;
  onStartEdit: (selection: ActiveCellSelection, initialValue?: string) => void;
  registerCell: (cellKey: string, element: HTMLTableCellElement | null) => void;
  sheet: Sheet;
}) {
  function handleCellKeyDown(event: KeyboardEvent<HTMLTableCellElement>) {
    const action = gridCellKeyboardAction({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      isActive,
      isCellTarget: event.target === event.currentTarget,
      key: event.key,
      metaKey: event.metaKey,
    });

    if (action.kind === 'none') {
      return;
    }

    event.preventDefault();

    if (action.kind === 'navigate') {
      onNavigateCell(sheet, cellKey, action.direction);
      return;
    }

    if (action.kind === 'clear-cell') {
      onClearCell({ sheetId: sheet.id, cellKey });
      return;
    }

    onStartEdit({ sheetId: sheet.id, cellKey }, action.initialValue);
  }

  return (
    <td
      aria-label={`${sheet.name} ${cellKey}${sheet.cells[cellKey] ? '' : ' empty'} cell`}
      className={`sheet-grid-cell${isActive ? ' sheet-grid-cell-active' : ''}${
        isEditing ? ' sheet-grid-cell-editing' : ''
      }`}
      data-active-cell={isActive ? 'true' : undefined}
      data-cell-key={cellKey}
      data-editing-cell={isEditing ? 'true' : undefined}
      data-testid="sheet-grid-cell"
      onClick={() => onSelectCell({ sheetId: sheet.id, cellKey })}
      onDoubleClick={() => onStartEdit({ sheetId: sheet.id, cellKey })}
      onFocus={() => onSelectCell({ sheetId: sheet.id, cellKey })}
      onKeyDown={handleCellKeyDown}
      ref={(cellElement) => registerCell(cellKey, cellElement)}
      tabIndex={0}
    >
      {isEditing && editingCell ? (
        <SheetGridCellEditor
          editingCell={editingCell}
          onCancelEdit={onCancelEdit}
          onCommitEdit={onCommitEdit}
          onCommitEditAndNavigate={onCommitEditAndNavigate}
          onEditValueChange={onEditValueChange}
          sheetName={sheet.name}
        />
      ) : (
        displayText
      )}
    </td>
  );
}

export function SheetGridCellEditor({
  editingCell,
  onCancelEdit,
  onCommitEdit,
  onCommitEditAndNavigate,
  onEditValueChange,
  sheetName,
}: {
  editingCell: EditingCell;
  onCancelEdit: () => void;
  onCommitEdit: (editToCommit?: EditingCell) => void;
  onCommitEditAndNavigate: (editToCommit: EditingCell, direction: 'tab' | 'enter') => void;
  onEditValueChange: (value: string) => void;
  sheetName: string;
}) {
  const editorSizing = cellEditorSizing(editingCell.value);

  return (
    <textarea
      aria-label={`${sheetName} ${editingCell.cellKey} editor`}
      autoFocus
      className="sheet-grid-cell-editor"
      data-max-height={CELL_EDITOR_MAX_HEIGHT}
      data-max-width={CELL_EDITOR_MAX_WIDTH}
      data-multiline-editor={editorSizing.multiline ? 'true' : undefined}
      data-visible-lines={editorSizing.visibleLineCount}
      onBlur={(event) => {
        const relatedTarget = event.relatedTarget as HTMLElement | null;
        if (relatedTarget?.dataset.sheetMenuAction === 'delete') {
          onCancelEdit();
          return;
        }

        onCommitEdit({ ...editingCell, value: event.currentTarget.value });
      }}
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
      style={{
        height: editorSizing.height,
        maxHeight: CELL_EDITOR_MAX_HEIGHT,
        maxWidth: CELL_EDITOR_MAX_WIDTH,
        overflow: 'auto',
        width: editorSizing.width,
      }}
      value={editingCell.value}
    />
  );
}

function cellEditorSizing(value: string) {
  const lines = value.split('\n');
  const lineCount = lines.length;
  const longestLineLength = Math.max(...lines.map((line) => line.length), 0);
  const visibleLineCount = Math.min(Math.max(lineCount, 1), 8);
  const visibleColumnCount = Math.min(Math.max(longestLineLength + 2, 12), 64);

  return {
    height: `min(${CELL_EDITOR_MAX_HEIGHT}, max(1.65rem, ${visibleLineCount * 1.45}rem))`,
    multiline: lineCount > 1,
    visibleLineCount,
    width: `min(${CELL_EDITOR_MAX_WIDTH}, max(100%, ${visibleColumnCount}ch))`,
  };
}
