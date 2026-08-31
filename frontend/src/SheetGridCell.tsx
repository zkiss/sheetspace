import { KeyboardEvent, type CSSProperties } from 'react';
import { cellRawContent, type SheetTabularProjection } from './workbook';
import type { CellEditSession, CellNavigationDirection, CellTarget } from './appTypes';
import { cellTargetAt } from './cellInteraction';
import { GRID_CELL_HEIGHT } from './gridGeometry';
import { gridCellKeyboardAction } from './sheetGridModel';
import { cssRemFromPixels } from './styleTokens';
import './SheetGridCell.css';

export const CELL_EDITOR_MAX_WIDTH = '28rem';
export const CELL_EDITOR_MAX_HEIGHT = '12rem';

export type SheetGridCellInteraction = {
  clear: (target: CellTarget) => void;
  navigate: (target: CellTarget, direction: CellNavigationDirection) => void;
  select: (target: CellTarget) => void;
  startEditing: (target: CellTarget, initialValue?: string) => void;
};

export type SheetGridCellEditorInteraction = {
  cancel: () => void;
  commit: (session?: CellEditSession) => void;
  commitAndNavigate: (session: CellEditSession, direction: 'tab' | 'enter') => void;
  updateValue: (value: string) => void;
};

function moveEditorCaretToEnd(editor: HTMLTextAreaElement | null) {
  if (!editor) {
    return;
  }

  const end = editor.value.length;
  editor.setSelectionRange(end, end);
}

export function SheetGridCell({
  cellKey,
  columnIndex,
  displayText,
  editingCell,
  isActive,
  isEditing,
  isNavigationTarget = false,
  isRangeSelected = false,
  cellInteraction,
  editorInteraction,
  registerCell,
  style,
  tabIndex = -1,
  sheet,
}: {
  cellKey: string;
  columnIndex: number;
  displayText: string;
  editingCell: CellEditSession | null;
  isActive: boolean;
  isEditing: boolean;
  isNavigationTarget?: boolean;
  isRangeSelected?: boolean;
  cellInteraction: SheetGridCellInteraction;
  editorInteraction: SheetGridCellEditorInteraction;
  registerCell?: (cellKey: string, element: HTMLElement | null) => void;
  sheet: SheetTabularProjection;
  style?: CSSProperties;
  tabIndex?: number;
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
      cellInteraction.navigate(target, action.direction);
      return;
    }

    if (action.kind === 'clear-cell') {
      cellInteraction.clear(target);
      return;
    }

    cellInteraction.startEditing(target, action.initialValue);
  }

  return (
    <div
      aria-label={`${sheet.name} ${cellKey}${cellRawContent(sheet, cellKey) ? '' : ' empty'} cell`}
      aria-colindex={columnIndex}
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
        if (target) cellInteraction.select(target);
      }}
      onDoubleClick={() => {
        const target = cellTargetAt(sheet, cellKey);
        if (target) cellInteraction.startEditing(target);
      }}
      onFocus={() => {
        if (!isActive) {
          const target = cellTargetAt(sheet, cellKey);
          if (target) cellInteraction.select(target);
        }
      }}
      onKeyDown={handleCellKeyDown}
      ref={(cellElement) => registerCell?.(cellKey, cellElement)}
      role="cell"
      style={style}
      tabIndex={tabIndex}
    >
      {isEditing && editingCell ? (
        <SheetGridCellEditor
          editingCell={editingCell}
          cellKey={cellKey}
          interaction={editorInteraction}
          sheetName={sheet.name}
        />
      ) : (
        displayText
      )}
    </div>
  );
}

export function SheetGridCellEditor({
  cellKey,
  editingCell,
  interaction,
  sheetName,
}: {
  cellKey: string;
  editingCell: CellEditSession;
  interaction: SheetGridCellEditorInteraction;
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
      onBlur={(event) => interaction.commit({ ...editingCell, draft: event.currentTarget.value })}
      onChange={(event) => interaction.updateValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          interaction.commitAndNavigate({ ...editingCell, draft: event.currentTarget.value }, 'enter');
        }

        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          interaction.commitAndNavigate({ ...editingCell, draft: event.currentTarget.value }, 'tab');
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          interaction.cancel();
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
    height: `min(${CELL_EDITOR_MAX_HEIGHT}, max(${cssRemFromPixels(GRID_CELL_HEIGHT)}, ${visibleLineCount * 1.45}rem))`,
    multiline: lineCount > 1,
    visibleLineCount,
    width: `min(${CELL_EDITOR_MAX_WIDTH}, max(100%, ${visibleColumnCount}ch))`,
  };
}
