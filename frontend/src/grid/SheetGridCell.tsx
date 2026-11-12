import { memo, useCallback, useMemo, useRef, type KeyboardEvent, type CSSProperties } from 'react';
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
  focusCurrentSelection?: () => number | null;
  settleSelectionGesture?: (owner: symbol) => void;
  startEditing: (target: CellTarget, initialValue?: string) => void;
};

type CellProps = Parameters<typeof Cell>[0];

export function SheetGridCell(props: CellProps) {
  const latest = useRef(props);
  latest.current = props;
  const hasKeyboard = Boolean(props.cellInteraction.navigateKeyboard);
  const hasExtend = Boolean(props.cellInteraction.extend);
  const hasFocus = Boolean(props.cellInteraction.focusSelection);
  const hasCurrentFocus = Boolean(props.cellInteraction.focusCurrentSelection);
  const hasSettle = Boolean(props.cellInteraction.settleSelectionGesture);
  const interaction = useMemo<SheetGridCellInteraction>(() => ({
    clear: (...args) => latest.current.cellInteraction.clear(...args),
    navigate: (...args) => latest.current.cellInteraction.navigate(...args),
    navigateKeyboard: hasKeyboard ? (...args) => latest.current.cellInteraction.navigateKeyboard!(...args) : undefined,
    select: (...args) => latest.current.cellInteraction.select(...args),
    extend: hasExtend ? (...args) => latest.current.cellInteraction.extend!(...args) : undefined,
    focusSelection: hasFocus ? (...args) => latest.current.cellInteraction.focusSelection!(...args) : undefined,
    focusCurrentSelection: hasCurrentFocus ? () => latest.current.cellInteraction.focusCurrentSelection!() : undefined,
    settleSelectionGesture: hasSettle ? (...args) => latest.current.cellInteraction.settleSelectionGesture!(...args) : undefined,
    startEditing: (...args) => latest.current.cellInteraction.startEditing(...args),
  }), [hasKeyboard, hasExtend, hasFocus, hasCurrentFocus, hasSettle]);
  const onNativeFocusTarget = useCallback((target: CellTarget) => latest.current.onNativeFocusTarget?.(target), []);
  return <MemoCell {...props} cellInteraction={interaction} onNativeFocusTarget={onNativeFocusTarget} />;
}

const MemoCell = memo(Cell, (before, after) => {
  for (const key of Object.keys(after) as (keyof CellProps)[]) {
    if (key === 'style') {
      const a = before.style ?? {};
      const b = after.style ?? {};
      const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof CSSProperties)[]);
      if ([...keys].some((name) => a[name] !== b[name])) return false;
    } else if (key === 'sheet') {
      const a = before.sheet;
      const b = after.sheet;
      if (a.id !== b.id || a.name !== b.name || a.revision !== b.revision
        || a.rows !== b.rows || a.columns !== b.columns || a.cells !== b.cells) return false;
    } else if (key === 'editorInteraction' && !before.isEditing && !after.isEditing) {
      continue;
    } else if (before[key] !== after[key]) return false;
  }
  return Object.keys(before).length === Object.keys(after).length;
});

function Cell({
  cellKey,
  columnIndex,
  motionColumnId,
  displayText,
  editingCell,
  isActive,
  selectionFadeOut,
  selectionFadeIn,
  isEditing,
  isFocusTarget = false,
  isNavigationTarget = false,
  historyFeedback,
  historyEdges,
  isRangeSelected = false,
  selectionEdges,
  isPendingCut = false,
  isCalculated = false,
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
  motionColumnId?: string;
  displayText: string;
  editingCell: CellEditSession | null;
  isActive: boolean;
  selectionFadeOut?: number;
  selectionFadeIn?: number;
  isEditing: boolean;
  isFocusTarget?: boolean;
  isNavigationTarget?: boolean;
  navigationHighlightIdentity?: number;
  historyFeedback?: { before: string | null; beforeDisplay: string | null; after: string | null };
  historyEdges?: string;
  isRangeSelected?: boolean;
  selectionEdges?: string;
  isPendingCut?: boolean;
  isCalculated?: boolean;
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
    if (event.defaultPrevented) return;
    const target = cellTargetAt(sheet, cellKey);
    if (!target) return;
    const action = gridCellKeyboardAction({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      code: event.code,
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
      // The cell presents the read-only affordance; the ownership authority
      // rejects a protected clear and the workspace reports that rejection.
      cellInteraction.clear(target);
      return;
    }

    if (!isCalculated || action.initialValue === undefined) cellInteraction.startEditing(target, action.initialValue);
  }

  return (
    <div
      aria-label={`${sheet.name} ${cellKey}${isCalculated ? ' calculated, read-only; edit it in Data models' : cellRawContent(sheet, cellKey) ? '' : ' empty'} cell`}
      aria-readonly={isCalculated ? 'true' : undefined}
      aria-colindex={columnIndex}
      aria-selected={isActive || isRangeSelected ? 'true' : undefined}
      className={`sheet-grid-cell${isActive ? ' sheet-grid-cell-active' : ''}${selectionFadeIn !== undefined && isActive ? ' sheet-grid-cell-selection-fade-in' : ''}${
        isRangeSelected ? ' sheet-grid-cell-range-selected' : ''
      }${selectionEdges ? ` ${selectionEdges}` : ''}${historyEdges ? ` ${historyEdges}` : ''}${isNavigationTarget ? ' sheet-grid-cell-navigation-target' : ''}${
        isEditing ? ' sheet-grid-cell-editing' : ''
      }${isCalculated ? ' sheet-grid-cell-calculated' : ''}${historyFeedback ? ` sheet-grid-cell-history-${historyFeedback.before === null ? 'insertion' : historyFeedback.after === null ? 'removal' : 'replacement'}` : ''}`}
      data-active-cell={isActive ? 'true' : undefined}
      data-cell-key={cellKey}
      data-motion-column={motionColumnId}
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
      {selectionFadeOut !== undefined && !isActive ? <span aria-hidden="true" className="sheet-grid-selection-fade-out" key={selectionFadeOut} /> : null}
      {isEditing && editingCell ? (
        <SheetGridCellEditor
          key={editingCell.sessionId}
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
