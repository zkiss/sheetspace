import { KeyboardEvent } from 'react';
import { cellRawContent, type SheetTabularProjection } from './workbook';
import type { CellEditSession, CellNavigationDirection, CellTarget } from './appTypes';
import { cellTargetAt } from './cellInteraction';
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
  isNavigationTarget = false,
  isRangeSelected = false,
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
  editingCell: CellEditSession | null;
  isActive: boolean;
  isEditing: boolean;
  isNavigationTarget?: boolean;
  isRangeSelected?: boolean;
  onCancelEdit: () => void;
  onClearCell: (target: CellTarget) => void;
  onCommitEdit: (session?: CellEditSession) => void;
  onCommitEditAndNavigate: (session: CellEditSession, direction: 'tab' | 'enter') => void;
  onEditValueChange: (value: string) => void;
  onNavigateCell: (target: CellTarget, direction: CellNavigationDirection) => void;
  onSelectCell: (target: CellTarget) => void;
  onStartEdit: (target: CellTarget, initialValue?: string) => void;
  registerCell: (cellKey: string, element: HTMLTableCellElement | null) => void;
  sheet: SheetTabularProjection;
}) {
  function handleCellKeyDown(event: KeyboardEvent<HTMLTableCellElement>) {
    const target = cellTargetAt(sheet, cellKey);
    if (!target) return;
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
      onNavigateCell(target, action.direction);
      return;
    }

    if (action.kind === 'clear-cell') {
      onClearCell(target);
      return;
    }

    onStartEdit(target, action.initialValue);
  }

  return (
    <td
      aria-label={`${sheet.name} ${cellKey}${cellRawContent(sheet, cellKey) ? '' : ' empty'} cell`}
      aria-selected={isActive || isRangeSelected ? 'true' : undefined}
      className={`sheet-grid-cell${isActive ? ' sheet-grid-cell-active' : ''}${
        isRangeSelected ? ' sheet-grid-cell-range-selected' : ''
      }${isNavigationTarget ? ' sheet-grid-cell-navigation-target' : ''}${
        isEditing ? ' sheet-grid-cell-editing' : ''
      }`}
      data-active-cell={isActive ? 'true' : undefined}
      data-cell-key={cellKey}
      data-editing-cell={isEditing ? 'true' : undefined}
      data-navigation-highlight={isNavigationTarget ? 'true' : undefined}
      data-reference-selected={isRangeSelected ? 'true' : undefined}
      data-testid="sheet-grid-cell"
      onClick={() => {
        const target = cellTargetAt(sheet, cellKey);
        if (target) onSelectCell(target);
      }}
      onDoubleClick={() => {
        const target = cellTargetAt(sheet, cellKey);
        if (target) onStartEdit(target);
      }}
      onFocus={() => {
        if (!isActive) {
          const target = cellTargetAt(sheet, cellKey);
          if (target) onSelectCell(target);
        }
      }}
      onKeyDown={handleCellKeyDown}
      ref={(cellElement) => registerCell(cellKey, cellElement)}
      tabIndex={0}
    >
      {isEditing && editingCell ? (
        <SheetGridCellEditor
          editingCell={editingCell}
          cellKey={cellKey}
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
  cellKey,
  editingCell,
  onCancelEdit,
  onCommitEdit,
  onCommitEditAndNavigate,
  onEditValueChange,
  sheetName,
}: {
  cellKey: string;
  editingCell: CellEditSession;
  onCancelEdit: () => void;
  onCommitEdit: (session?: CellEditSession) => void;
  onCommitEditAndNavigate: (session: CellEditSession, direction: 'tab' | 'enter') => void;
  onEditValueChange: (value: string) => void;
  sheetName: string;
}) {
  const editorSizing = cellEditorSizing(editingCell.draft);

  return (
    <textarea
      aria-label={`${sheetName} ${cellKey} editor`}
      autoFocus
      className="sheet-grid-cell-editor"
      data-max-height={CELL_EDITOR_MAX_HEIGHT}
      data-max-width={CELL_EDITOR_MAX_WIDTH}
      data-multiline-editor={editorSizing.multiline ? 'true' : undefined}
      data-visible-lines={editorSizing.visibleLineCount}
      onBlur={(event) => onCommitEdit({ ...editingCell, draft: event.currentTarget.value })}
      onChange={(event) => onEditValueChange(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          onCommitEditAndNavigate({ ...editingCell, draft: event.currentTarget.value }, 'enter');
        }

        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          onCommitEditAndNavigate({ ...editingCell, draft: event.currentTarget.value }, 'tab');
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
      value={editingCell.draft}
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
