import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cellRawContent } from '@workbook/read/queries';
import { type SheetTabularProjection } from '@workbook/core/model';
import type { SelectionGesture, CellEditSession, CellNavigationDirection, CellNavigationRequest, CellTarget } from './cellInteractionContracts';
import { cellTargetAt } from '@grid/cellInteraction';
import { gridCellKeyboardAction } from './sheetGridModel';
import '@grid/SheetGridCell.css';

export const CELL_EDITOR_MAX_WIDTH = '28rem';
export const CELL_EDITOR_MAX_HEIGHT = '7rem';

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

export type SheetGridCellEditorInteraction = {
  cancel: () => void;
  commit: (session?: CellEditSession) => void;
  commitAndNavigate: (session: CellEditSession, request: Pick<CellNavigationRequest, 'key' | 'shift'>) => void;
  updateValue: (value: string) => void;
};

function moveEditorCaretToEnd(editor: HTMLTextAreaElement | null) {
  if (!editor) {
    return;
  }

  const end = editor.value.length;
  editor.setSelectionRange(end, end);
}

function sizeEditorToContent(editor: HTMLTextAreaElement | null, minimumHeight: number) {
  if (!editor) return;
  editor.style.height = '0px';
  const maxHeight = Number.parseFloat(getComputedStyle(editor).maxHeight) || 192;
  editor.style.height = `${Math.min(Math.max(minimumHeight, editor.scrollHeight), maxHeight)}px`;
  editor.style.overflowY = editor.scrollHeight > maxHeight ? 'auto' : 'hidden';
  editor.style.overflowX = editor.scrollWidth > editor.clientWidth ? 'auto' : 'hidden';
}

export function SheetGridCell({
  cellKey,
  columnIndex,
  displayText,
  editingCell,
  isActive,
  isEditing,
  isFocusTarget = false,
  isNavigationTarget = false,
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
       ref={(cellElement) => {
         cellElementRef.current = cellElement;
         registerCell?.(cellKey, cellElement);
       }}
      role="cell"
      style={style}
      tabIndex={tabIndex}
    >
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

export function SheetGridCellEditor({
  anchor,
  cellKey,
  editingCell,
  interaction,
  sheetName,
}: {
  anchor: RefObject<HTMLElement | null>;
  cellKey: string;
  editingCell: CellEditSession;
  interaction: SheetGridCellEditorInteraction;
  sheetName: string;
}) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const hasPlacedInitialCaret = useRef(false);
  const hasFinishedEditing = useRef(false);

  const updatePosition = () => {
    const next = anchor.current?.getBoundingClientRect() ?? null;
    setAnchorRect((current) => sameRect(current, next) ? current : next);
  };

  useLayoutEffect(() => {
    updatePosition();
  });

  useEffect(() => {
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const observer = typeof ResizeObserver === 'undefined' || !anchor.current
      ? null
      : new ResizeObserver(updatePosition);
    if (anchor.current) observer?.observe(anchor.current);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      observer?.disconnect();
    };
  }, [anchor]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || !anchorRect) return;
    if (!hasPlacedInitialCaret.current) {
      moveEditorCaretToEnd(editor);
      hasPlacedInitialCaret.current = true;
    }
    sizeEditorToContent(editor, anchorRect.height);
  }, [anchorRect, editingCell.draft]);

  if (!anchorRect) return null;
  const editorSizing = cellEditorSizing(editingCell.draft, anchorRect.width, anchorRect.height);

  const editor = (
    <textarea
      aria-label={`${sheetName} ${cellKey} editor`}
      autoFocus
      className="sheet-grid-cell-editor"
      data-max-height={CELL_EDITOR_MAX_HEIGHT}
      data-max-width={CELL_EDITOR_MAX_WIDTH}
      data-multiline-editor={editorSizing.multiline ? 'true' : undefined}
      data-visible-lines={editorSizing.visibleLineCount}
      onBlur={(event) => {
        if (!hasFinishedEditing.current) interaction.commit({ ...editingCell, draft: event.currentTarget.value });
      }}
      onChange={(event) => interaction.updateValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
       onKeyDown={(event) => {
        if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          const editor = event.currentTarget;
          editor.setRangeText('\n', editor.selectionStart, editor.selectionEnd, 'end');
          interaction.updateValue(editor.value);
          return;
        }

        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          hasFinishedEditing.current = true;
          interaction.commitAndNavigate(
            { ...editingCell, draft: event.currentTarget.value },
            { key: 'Enter', shift: event.shiftKey },
          );
          return;
        }

        if (event.key === 'Enter') {
          // Only Shift+Enter is a multiline command. Other modified Enter
          // combinations are reserved and must not insert a native newline.
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          interaction.commitAndNavigate(
            { ...editingCell, draft: event.currentTarget.value },
            { key: 'Tab', shift: event.shiftKey },
          );
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          hasFinishedEditing.current = true;
          interaction.cancel();
        }
      }}
        ref={editorRef}
      style={{
        height: editorSizing.height,
        left: anchorRect.left,
        maxHeight: CELL_EDITOR_MAX_HEIGHT,
        maxWidth: `min(${CELL_EDITOR_MAX_WIDTH}, calc(100vw - ${anchorRect.left + 12}px))`,
        overflow: 'auto',
        top: anchorRect.top,
        width: editorSizing.width,
      }}
      value={editingCell.draft}
    />
  );
  return createPortal(editor, document.body);
}

function sameRect(left: DOMRect | null, right: DOMRect | null) {
  if (!left || !right) return left === right;
  return left.left === right.left && left.top === right.top
    && left.width === right.width && left.height === right.height;
}

function cellEditorSizing(value: string, minimumWidth: number, minimumHeight: number) {
  const lines = value.split('\n');
  const lineCount = lines.length;
  const longestLineLength = Math.max(...lines.map((line) => line.length), 0);
  const visibleLineCount = Math.min(Math.max(lineCount, 1), 8);
  const visibleColumnCount = Math.min(Math.max(longestLineLength + 2, 1), 64);

  return {
    height: `min(${CELL_EDITOR_MAX_HEIGHT}, max(${minimumHeight}px, ${visibleLineCount * 1.45}rem))`,
    multiline: lineCount > 1,
    visibleLineCount,
    width: `min(${CELL_EDITOR_MAX_WIDTH}, max(${minimumWidth}px, ${visibleColumnCount}ch))`,
  };
}
