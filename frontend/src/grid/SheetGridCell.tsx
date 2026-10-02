import { useCallback, useRef, type KeyboardEvent, type CSSProperties } from 'react';
import { cellRawContent } from '@workbook/read/queries';
import { type SheetTabularProjection } from '@workbook/core/model';
import type { SelectionGesture, CellEditSession, CellNavigationDirection, CellNavigationRequest, CellTarget } from './cellInteractionContracts';
import { cellTargetAt } from '@grid/cellInteraction';
import { gridCellKeyboardAction } from './sheetGridModel';
import { SheetGridCellEditor, type SheetGridCellEditorInteraction } from './SheetGridCellEditor';
import '@grid/SheetGridCell.css';

export type SheetGridCellInteraction = {
  clear: (target: CellTarget) => void;
  navigate: (target: CellTarget, direction: CellNavigationDirection, extend?: boolean) => void;
  navigateKeyboard?: (target: CellTarget, request: CellNavigationRequest) => boolean;
  select: (target: CellTarget, gesture?: SelectionGesture) => void;
  extend?: (target: CellTarget, gesture?: SelectionGesture) => void;
  focusSelection?: (target: CellTarget, gesture?: SelectionGesture) => void;
  settleSelectionGesture?: (owner: symbol) => void;
  startEditing: (target: CellTarget, initialValue?: string) => void;
};

export function SheetGridCell({
  cellKey,
  columnIndex,
  displayText,
  editingCell,
  isActive,
  isEditing,
  isFocusTarget = false,
  isNavigationTarget = false,
  navigationHighlightIdentity,
  historyFeedback,
  historyEdges,
  isRangeSelected = false,
  selectionEdges,
  isPendingCut = false,
  cellInteraction,
  editorInteraction,
  onNativeFocusTarget,
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
  isFocusTarget?: boolean;
  isNavigationTarget?: boolean;
  navigationHighlightIdentity?: number;
  historyFeedback?: { before: string | null; beforeDisplay: string | null; after: string | null };
  historyEdges?: string;
  isRangeSelected?: boolean;
  selectionEdges?: string;
  isPendingCut?: boolean;
  cellInteraction: SheetGridCellInteraction;
  editorInteraction: SheetGridCellEditorInteraction;
  onNativeFocusTarget?: (target: CellTarget) => void;
  registerCell?: (cellKey: string, element: HTMLElement | null) => void;
  sheet: SheetTabularProjection;
  style?: CSSProperties;
  tabIndex?: number;
}) {
  const cellElementRef = useRef<HTMLDivElement | null>(null);
  const attachCell = useCallback((element: HTMLDivElement | null) => {
    cellElementRef.current = element;
    registerCell?.(cellKey, element);
  }, [cellKey, registerCell]);
  function handleCellKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = cellTargetAt(sheet, cellKey);
    if (!target) return;
    const action = gridCellKeyboardAction({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      isActive,
      isCellTarget: event.target === event.currentTarget,
      key: event.key,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });

    if (action.kind === 'none') {
      return;
    }

    event.preventDefault();

    if (action.kind === 'navigate') {
      if (cellInteraction.navigateKeyboard) {
        if (!cellInteraction.navigateKeyboard(target, action.request)) return;
        return;
      }
      const directions = {
        ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      } as const;
      const direction = directions[action.request.key as keyof typeof directions];
      if (!direction) return;
      if (action.request.shift) cellInteraction.navigate(target, direction, true);
      else cellInteraction.navigate(target, direction);
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
      }${selectionEdges ? ` ${selectionEdges}` : ''}${historyEdges ? ` ${historyEdges}` : ''}${isNavigationTarget ? ' sheet-grid-cell-navigation-target' : ''}${
        isEditing ? ' sheet-grid-cell-editing' : ''
      }${historyFeedback ? ` sheet-grid-cell-history-${historyFeedback.before === null ? 'insertion' : historyFeedback.after === null ? 'removal' : 'replacement'}` : ''}`}
      data-active-cell={isActive ? 'true' : undefined}
      data-cell-key={cellKey}
      data-editing-cell={isEditing ? 'true' : undefined}
      data-navigation-highlight={isNavigationTarget ? 'true' : undefined}
      data-history-feedback={historyFeedback ? 'true' : undefined}
      data-history-before={historyFeedback?.beforeDisplay ?? undefined}
      data-reference-selected={isRangeSelected ? 'true' : undefined}
      data-pending-cut={isPendingCut ? 'true' : undefined}
      data-testid="sheet-grid-cell"
      onClick={(event) => {
        // Pointer selection is committed on pointer-down so a drag can extend it.
        // The browser emits a click after that gesture; handling it would collapse
        // the completed range back to the pointer-down cell. Keyboard activation
        // has detail 0 and still uses this path.
        if (event.detail !== 0) return;
        const target = cellTargetAt(sheet, cellKey);
        if (!target) return;
        if (event.shiftKey && cellInteraction.extend) cellInteraction.extend(target);
        else cellInteraction.select(target);
      }}
      onDoubleClick={() => {
        const target = cellTargetAt(sheet, cellKey);
        if (target) cellInteraction.startEditing(target);
      }}
      onFocus={() => {
        const target = cellTargetAt(sheet, cellKey);
        // Application focus requests return focus to an existing stable
        // selection (for example after using presentation controls). They must
        // not convert an axis/range selection into a single-cell selection.
        if (!isActive && !isFocusTarget) {
          if (target) cellInteraction.select(target);
        }
        if (target) onNativeFocusTarget?.(target);
      }}
      onKeyDown={handleCellKeyDown}
      ref={attachCell}
      role="cell"
      style={style}
      tabIndex={tabIndex}
    >
      {isNavigationTarget && (
        <span aria-hidden="true" className="sheet-grid-navigation-feedback" key={navigationHighlightIdentity} />
      )}
      {isEditing && editingCell ? (
        <SheetGridCellEditor
          anchor={cellElementRef}
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
