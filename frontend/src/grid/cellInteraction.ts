import { cellAddressOf, cellIdentityAt } from '@workbook/core/cellIdentity';
import { cellKey } from '@workbook/core/address';
import { type SheetDocument, type SheetTabularProjection } from '@workbook/core/model';
import type { SelectionGesture, CellEditSession, CellSelection, CellSelectionMode, CellTarget, ReferenceNavigationTarget } from './cellInteractionContracts';

export type CellInteractionState = {
  selection: CellTarget | null;
  selectionOwner: symbol | null;
  rangeSelection: CellSelection | null;
  editing: CellEditSession | null;
  focusRequest: CellFocusRequest | null;
  nextFocusRequestId: number;
  referenceSelection: ReferenceNavigationTarget | null;
  tabRunOriginColumnId: string | null;
};

export type CellFocusRequest = {
  id: number;
  target: CellTarget;
};

export const EMPTY_CELL_INTERACTION_STATE: CellInteractionState = {
  selection: null,
  selectionOwner: null,
  rangeSelection: null,
  editing: null,
  focusRequest: null,
  nextFocusRequestId: 1,
  referenceSelection: null,
  tabRunOriginColumnId: null,
};

export type CellInteractionAction =
  | { type: 'select'; target: CellTarget; gesture?: SelectionGesture }
  | { type: 'extend-selection'; target: CellTarget; requestFocus?: boolean; gesture?: SelectionGesture }
  | { type: 'settle-selection-gesture'; gesture: SelectionGesture }
  | { type: 'select-axis'; mode: Exclude<CellSelectionMode, 'cells'>; target: CellTarget; extend: boolean; gesture?: SelectionGesture }
  | { type: 'select-reference'; target: ReferenceNavigationTarget }
  | { type: 'start-edit'; session: CellEditSession }
  | { type: 'update-draft'; draft: string }
  | { type: 'commit' }
  | { type: 'cancel' }
  | { type: 'clear'; target: CellTarget }
  | { type: 'navigate'; target: CellTarget }
  | { type: 'traverse-range'; target: CellTarget }
  | { type: 'commit-tab'; target: CellTarget; originColumnId: string }
  | { type: 'commit-enter'; target: CellTarget }
  | { type: 'focus-current-selection' }
  | { type: 'acknowledge-focus'; requestId: number }
  | { type: 'prune-sheets'; sheetIds: ReadonlySet<string> };

function referenceStart(target: ReferenceNavigationTarget): CellTarget {
  return target.kind === 'cell'
    ? target.target
    : { sheetId: target.sheetId, cell: target.range.start };
}

export function cellInteractionReducer(
  state: CellInteractionState,
  action: CellInteractionAction,
): CellInteractionState {
  // Reducer checks also reject stale dispatches queued between renders.
  if ('gesture' in action && action.gesture && !action.gesture.start
    && action.type !== 'select' && state.selectionOwner !== action.gesture.owner) return state;
  switch (action.type) {
    case 'select':
      return {
        ...state,
        selection: action.target,
        selectionOwner: action.gesture?.owner ?? null,
        rangeSelection: { mode: 'cells', anchor: action.target, extent: action.target },
        focusRequest: null,
        referenceSelection: null,
        tabRunOriginColumnId: sameTarget(state.selection, action.target) ? state.tabRunOriginColumnId : null,
      };
    case 'extend-selection': {
      const anchor = state.rangeSelection?.anchor;
      // A range never crosses sheets.  A new sheet starts a fresh selection.
      if (!anchor || anchor.sheetId !== action.target.sheetId) {
        return cellInteractionReducer(state, { type: 'select', target: action.target, gesture: action.gesture });
      }
      const extended = {
        ...state,
        selection: action.target,
        selectionOwner: action.gesture?.owner ?? null,
        rangeSelection: { mode: state.rangeSelection?.mode ?? 'cells', anchor, extent: action.target },
        focusRequest: null,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      };
      return action.requestFocus ? withFocusRequest(extended, action.target) : extended;
    }
    case 'settle-selection-gesture':
      // A completed pointer gesture leaves a stable range available for editing
      // and Tab/Enter traversal. Retain the owner only while callbacks from the
      // live gesture must be rejected.
      return { ...state, selectionOwner: null };
    case 'select-axis': {
      const canExtend = action.extend
        && state.rangeSelection?.mode === action.mode
        && state.rangeSelection.anchor.sheetId === action.target.sheetId;
      return {
        ...state,
        selection: action.target,
        selectionOwner: action.gesture?.owner ?? null,
        rangeSelection: {
          mode: action.mode,
          anchor: canExtend ? state.rangeSelection!.anchor : action.target,
          extent: action.target,
        },
        editing: null,
        focusRequest: null,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      };
    }
    case 'select-reference': {
      const target = referenceStart(action.target);
      return withFocusRequest({
        ...state,
        selection: target,
        selectionOwner: null,
        rangeSelection: action.target.kind === 'range'
          ? {
              mode: 'cells',
              anchor: { sheetId: action.target.sheetId, cell: action.target.range.start },
              extent: { sheetId: action.target.sheetId, cell: action.target.range.end },
            }
          : { mode: 'cells', anchor: target, extent: target },
        editing: null,
        referenceSelection: action.target,
        tabRunOriginColumnId: null,
      }, target);
    }
    case 'start-edit':
      return {
        ...state,
        selection: action.session.target,
        selectionOwner: null,
        // Editing the active member of a rectangular selection must not lose
        // that rectangle: Tab/Enter commits traverse its existing bounds.
        rangeSelection: preservesRectangularRange(state, action.session.target)
          ? state.rangeSelection
          : { mode: 'cells', anchor: action.session.target, extent: action.session.target },
        editing: action.session,
        referenceSelection: null,
      };
    case 'update-draft':
      return state.editing ? { ...state, editing: { ...state.editing, draft: action.draft } } : state;
    case 'commit':
      return { ...state, editing: null };
    case 'cancel':
      return state.editing ? withFocusRequest({ ...state, editing: null }, state.editing.target) : state;
    case 'clear':
      // Clearing contents is not a selection operation. Keep a range (including
      // a whole-row or whole-column selection) intact for subsequent navigation.
      if (sameTarget(state.selection, action.target)) {
        return withFocusRequest({
          ...state,
          editing: null,
          referenceSelection: null,
        }, action.target);
      }
      return withFocusRequest({
        ...state,
        selection: action.target,
        selectionOwner: null,
        rangeSelection: { mode: 'cells', anchor: action.target, extent: action.target },
        editing: null,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      }, action.target);
    case 'navigate':
      return withFocusRequest({
        ...state,
        selection: action.target,
        selectionOwner: null,
        rangeSelection: { mode: 'cells', anchor: action.target, extent: action.target },
        editing: null,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      }, action.target);
    case 'traverse-range':
      // Tab and Enter move the active cell inside an already-selected
      // rectangle. Keep its stable bounds so the next traversal can wrap.
      // Callers only issue this for a valid multi-cell selection; falling back
      // to ordinary navigation keeps queued or stale actions deterministic.
      if (state.rangeSelection?.mode !== 'cells'
        || state.rangeSelection.anchor.sheetId !== action.target.sheetId) {
        return cellInteractionReducer(state, { type: 'navigate', target: action.target });
      }
      return withFocusRequest({
        ...state,
        selection: action.target,
        selectionOwner: null,
        editing: null,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      }, action.target);
    case 'commit-tab':
      return withFocusRequest({
        ...state,
        selection: action.target,
        selectionOwner: null,
        rangeSelection: { mode: 'cells', anchor: action.target, extent: action.target },
        editing: null,
        referenceSelection: null,
        tabRunOriginColumnId: action.originColumnId,
      }, action.target);
    case 'commit-enter':
      return withFocusRequest({
        ...state,
        selection: action.target,
        selectionOwner: null,
        rangeSelection: { mode: 'cells', anchor: action.target, extent: action.target },
        editing: null,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      }, action.target);
    case 'focus-current-selection':
      // Formatting and other presentation commands can temporarily move native
      // focus to a toolbar control. Restore the already-stable selection without
      // changing its range, mode, or ownership.
      return state.selection ? withFocusRequest(state, state.selection) : state;
    case 'acknowledge-focus':
      return state.focusRequest?.id === action.requestId ? { ...state, focusRequest: null } : state;
    case 'prune-sheets': {
      const keep = (target: CellTarget | null) => target && action.sheetIds.has(target.sheetId) ? target : null;
      const referenceSelection = state.referenceSelection
        && action.sheetIds.has(referenceStart(state.referenceSelection).sheetId)
        ? state.referenceSelection
        : null;
      return {
        ...state,
        selection: keep(state.selection),
        selectionOwner: keep(state.selection) ? state.selectionOwner : null,
        rangeSelection: state.rangeSelection && action.sheetIds.has(state.rangeSelection.anchor.sheetId)
          ? state.rangeSelection : null,
        editing: state.editing && action.sheetIds.has(state.editing.target.sheetId) ? state.editing : null,
        focusRequest: state.focusRequest && keep(state.focusRequest.target) ? state.focusRequest : null,
        referenceSelection,
      };
    }
  }
}

function preservesRectangularRange(state: CellInteractionState, target: CellTarget) {
  // A live pointer gesture owns its selection until it releases. Starting an
  // edit from another context replaces that selection, so a stale move/RAF
  // callback cannot retain or restore its range. Completed pointer and
  // keyboard-created ranges remain available for Enter/Tab traversal.
  if (state.selectionOwner !== null) return false;
  const selection = state.rangeSelection;
  if (!selection || selection.mode !== 'cells' || selection.anchor.sheetId !== target.sheetId
    || selection.extent.sheetId !== target.sheetId || !sameTarget(selection.extent, target)) return false;
  return selection.anchor.cell.rowId !== selection.extent.cell.rowId
    || selection.anchor.cell.columnId !== selection.extent.cell.columnId;
}

function withFocusRequest(state: CellInteractionState, target: CellTarget): CellInteractionState {
  return {
    ...state,
    focusRequest: { id: state.nextFocusRequestId, target },
    nextFocusRequestId: state.nextFocusRequestId + 1,
  };
}

export function cellTargetAt(
  sheet: SheetDocument | SheetTabularProjection,
  key: string,
): CellTarget | undefined {
  const content = 'content' in sheet ? sheet.content : sheet;
  const cell = cellIdentityAt(content, key);
  return cell ? { sheetId: sheet.id, cell } : undefined;
}

export function cellKeyForTarget(
  sheet: SheetDocument | SheetTabularProjection,
  target: CellTarget | null,
): string | null {
  if (!target || target.sheetId !== sheet.id) return null;
  const content = 'content' in sheet ? sheet.content : sheet;
  const address = cellAddressOf(content, target.cell);
  return address ? cellKey(address) : null;
}

export function sameTarget(left: CellTarget | null, right: CellTarget | null) {
  return Boolean(left && right
    && left.sheetId === right.sheetId
    && left.cell.rowId === right.cell.rowId
    && left.cell.columnId === right.cell.columnId);
}
