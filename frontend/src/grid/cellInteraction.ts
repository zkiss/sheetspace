import { cellAddressOf, cellIdentityAt } from '@workbook/core/cellIdentity';
import { cellKey } from '@workbook/core/address';
import { type SheetDocument, type SheetTabularProjection } from '@workbook/core/model';
import type { SelectionGesture, CellEditSession, CellSelection, CellSelectionMode, CellTarget, ReferenceNavigationTarget } from './cellInteractionContracts';
import { formulaDraftKey } from './formulaDrafts';
import { extendAxisSelection, projectSelection, pruneAxisSelection, toggleAxisMember } from '@workbook/read/selection';

export type CellInteractionState = {
  selection: CellTarget | null;
  selectionsBySheet: Readonly<Record<string, CellTarget>>;
  selectionOwner: symbol | null;
  rangeSelection: CellSelection | null;
  editing: CellEditSession | null;
  drafts: Readonly<Record<string, CellEditSession>>;
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
  selectionsBySheet: {},
  selectionOwner: null,
  rangeSelection: null,
  editing: null,
  drafts: {},
  focusRequest: null,
  nextFocusRequestId: 1,
  referenceSelection: null,
  tabRunOriginColumnId: null,
};

export type CellInteractionAction =
  | { type: 'select'; target: CellTarget; gesture?: SelectionGesture }
  | { type: 'activate-sheet'; target: CellTarget; requestFocus?: boolean }
  | { type: 'extend-selection'; target: CellTarget; requestFocus?: boolean; gesture?: SelectionGesture; sheet?: SheetDocument }
  | { type: 'settle-selection-gesture'; gesture: SelectionGesture }
  | { type: 'select-axis'; mode: Exclude<CellSelectionMode, 'cells'>; target: CellTarget; extend: boolean; intent?: 'plain' | 'extend' | 'toggle'; sheet?: SheetDocument; gesture?: SelectionGesture }
  | { type: 'select-reference'; target: ReferenceNavigationTarget }
  | { type: 'restore-selection'; selection: CellSelection | null }
  | { type: 'start-edit'; session: CellEditSession; replaceSuspendedDraft?: boolean }
  | { type: 'update-draft'; session: CellEditSession; draft: string }
  | { type: 'update-editor-state'; session: CellEditSession; selection: { start: number; end: number }; scrollTop: number }
  // A final DOM snapshot may arrive after navigation has suspended this same
  // overlay.  The reducer owns that ordering decision, not a render-time ref.
  | { type: 'suspend'; session: CellEditSession }
  | { type: 'commit'; session: CellEditSession }
  | { type: 'cancel'; session: CellEditSession }
  | { type: 'clear'; target: CellTarget }
  | { type: 'navigate'; target: CellTarget }
  | { type: 'traverse-range'; target: CellTarget }
  | { type: 'commit-tab'; target: CellTarget; originColumnId: string }
  | { type: 'commit-enter'; target: CellTarget }
  | { type: 'focus-current-selection' }
  | { type: 'acknowledge-focus'; requestId: number }
  | { type: 'cancel-focus'; requestId: number }
  | { type: 'clear-selection' }
  | { type: 'reconcile-selection'; sheets: readonly SheetDocument[] }
  | { type: 'prune-sheets'; sheetIds: ReadonlySet<string> }
  | { type: 'prune-drafts'; targetKeys: ReadonlySet<string> };

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
        selectionsBySheet: { ...state.selectionsBySheet, [action.target.sheetId]: action.target },
        selectionOwner: action.gesture?.owner ?? null,
        rangeSelection: { mode: 'cells', anchor: action.target, extent: action.target },
        focusRequest: null,
        referenceSelection: null,
        tabRunOriginColumnId: sameTarget(state.selection, action.target) ? state.tabRunOriginColumnId : null,
        ...suspendEdit(state),
      };
    case 'activate-sheet': {
      const activated: CellInteractionState = {
        ...state,
        selection: action.target,
        selectionsBySheet: { ...state.selectionsBySheet, [action.target.sheetId]: action.target },
        selectionOwner: null,
        rangeSelection: { mode: 'cells', anchor: action.target, extent: action.target },
        ...suspendEdit(state),
        focusRequest: null,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      };
      return action.requestFocus === false ? activated : withFocusRequest(activated, action.target);
    }
    case 'extend-selection': {
      if (action.sheet && state.rangeSelection?.mode !== 'cells' && state.rangeSelection?.members
        && state.selection?.sheetId === action.sheet.id) {
        const reconciled = reconcileCellSelection(state, [action.sheet], true);
        if (action.gesture && !action.gesture.start && reconciled.selectionOwner !== action.gesture.owner) return reconciled;
        if (reconciled.rangeSelection?.mode === 'cells' || !reconciled.rangeSelection) return reconciled;
        state = reconciled;
      }
      const anchor = state.rangeSelection?.anchor;
      // A range never crosses sheets.  A new sheet starts a fresh selection.
      if (!anchor || anchor.sheetId !== action.target.sheetId) {
        return cellInteractionReducer(state, { type: 'select', target: action.target, gesture: action.gesture });
      }
      const current = state.rangeSelection;
      if (action.sheet && current && current.mode !== 'cells' && current.members) {
        const pruned = pruneAxisSelection(action.sheet, { ...current, mode: current.mode, members: current.members });
        if (pruned) {
          const id = current.mode === 'rows' ? action.target.cell.rowId : action.target.cell.columnId;
          const selection = extendAxisSelection(action.sheet, pruned, id);
          if (selection && projectSelection(action.sheet, selection)) {
            const target = cellKeyForTarget(action.sheet, action.target) ? action.target : selection.extent;
            const extended = { ...state, selection: target,
              selectionsBySheet: { ...state.selectionsBySheet, [target.sheetId]: target },
              selectionOwner: action.gesture?.owner ?? null, rangeSelection: { ...selection, extent: target },
              focusRequest: null, referenceSelection: null, tabRunOriginColumnId: null };
            return action.requestFocus ? withFocusRequest(extended, target) : extended;
          }
        }
        return state;
      }
      const extended = {
        ...state,
          selection: action.target,
          selectionsBySheet: { ...state.selectionsBySheet, [action.target.sheetId]: action.target },
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
      if (action.sheet) {
        const { sheet, mode, target } = action;
        if (state.rangeSelection?.mode !== 'cells' && state.rangeSelection?.members && state.selection?.sheetId === sheet.id) {
          const reconciled = reconcileCellSelection(state, [sheet], true);
          if (action.gesture && !action.gesture.start && reconciled.selectionOwner !== action.gesture.owner) return reconciled;
          state = reconciled;
        }
        const single = { mode, anchor: target, extent: target, members: [mode === 'rows' ? target.cell.rowId : target.cell.columnId] };
        if (!projectSelection(sheet, single)) return state;
        const previous = state.rangeSelection;
        const current = previous?.mode === mode && previous.members && previous.anchor.sheetId === target.sheetId
          ? pruneAxisSelection(sheet, { ...previous, mode, members: previous.members }) : undefined;
        const intent = action.intent ?? (action.extend ? 'extend' : 'plain');
        const id = single.members[0]!;
        const selection = current && intent === 'extend' ? extendAxisSelection(sheet, current, id)
          : current && intent === 'toggle' ? toggleAxisMember(sheet, current, id)
            : single;
        if (!selection) return cellInteractionReducer(state, { type: 'select', target, gesture: action.gesture });
        const active = intent === 'toggle' ? selection.extent : target;
        return {
          ...state,
          selection: active,
          selectionsBySheet: { ...state.selectionsBySheet, [active.sheetId]: active },
          selectionOwner: action.gesture?.owner ?? null,
          rangeSelection: { ...selection, extent: active },
          ...suspendEdit(state),
          focusRequest: null,
          referenceSelection: null,
          tabRunOriginColumnId: null,
        };
      }
      const canExtend = action.extend
        && state.rangeSelection?.mode === action.mode
        && state.rangeSelection.anchor.sheetId === action.target.sheetId;
      return {
        ...state,
        selection: action.target,
        selectionsBySheet: { ...state.selectionsBySheet, [action.target.sheetId]: action.target },
        selectionOwner: action.gesture?.owner ?? null,
        rangeSelection: {
          mode: action.mode,
          anchor: canExtend ? state.rangeSelection!.anchor : action.target,
          extent: action.target,
        },
        ...suspendEdit(state),
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
        selectionsBySheet: { ...state.selectionsBySheet, [target.sheetId]: target },
        selectionOwner: null,
        rangeSelection: action.target.kind === 'range'
          ? {
              mode: 'cells',
              anchor: { sheetId: action.target.sheetId, cell: action.target.range.start },
              extent: { sheetId: action.target.sheetId, cell: action.target.range.end },
            }
          : { mode: 'cells', anchor: target, extent: target },
        ...suspendEdit(state),
        referenceSelection: action.target,
        tabRunOriginColumnId: null,
      }, target);
    }
    case 'restore-selection': {
      if (!action.selection) {
        return {
          ...state,
          selection: null,
          selectionOwner: null,
          rangeSelection: null,
          referenceSelection: null,
          focusRequest: null,
          tabRunOriginColumnId: null,
        };
      }
      return {
        ...state,
        selection: action.selection.extent,
        selectionsBySheet: { ...state.selectionsBySheet, [action.selection.extent.sheetId]: action.selection.extent },
        selectionOwner: null,
        rangeSelection: action.selection,
        referenceSelection: null,
        focusRequest: null,
        tabRunOriginColumnId: null,
      };
    }
    case 'start-edit':
      {
        const suspendedDraft = state.drafts[cellDraftKey(action.session.target)];
        // Resuming restores the target's draft and view state, but opening the
        // overlay is still a new callback lifetime.
        const editing = !action.replaceSuspendedDraft && suspendedDraft
          ? { ...suspendedDraft, sessionId: action.session.sessionId }
          : action.session;
        const suspended = suspendEdit(state);
        const drafts = suspended.drafts ?? state.drafts;
        return {
          ...state,
          selection: action.session.target,
          selectionsBySheet: { ...state.selectionsBySheet, [action.session.target.sheetId]: action.session.target },
          selectionOwner: null,
          // Editing the active member of a rectangular selection must not lose
          // that rectangle: Tab/Enter commits traverse its existing bounds.
          rangeSelection: preservesRectangularRange(state, action.session.target)
            ? state.rangeSelection
            : { mode: 'cells', anchor: action.session.target, extent: action.session.target },
          ...suspended,
          editing,
          // Active and suspended copies always carry the fresh callback
          // generation.  An older overlay can therefore never refine a resume.
          drafts: { ...drafts, [cellDraftKey(action.session.target)]: editing },
          referenceSelection: null,
        };
      }
    case 'update-draft': {
      if (!state.editing || !sameSession(state.editing, action.session)) return state;
      const editing = { ...state.editing, draft: action.draft };
      return { ...state, editing, drafts: { ...state.drafts, [cellDraftKey(editing.target)]: editing } };
    }
    case 'update-editor-state': {
      if (!state.editing || !sameSession(state.editing, action.session)) return state;
      const editing = { ...state.editing, selection: action.selection, scrollTop: action.scrollTop };
      return { ...state, editing, drafts: { ...state.drafts, [cellDraftKey(editing.target)]: editing } };
    }
    case 'suspend': {
      const snapshot = normalizeSnapshot(action.session);
      if (sameSession(state.editing, snapshot)) {
        return { ...state, editing: null, drafts: { ...state.drafts, [cellDraftKey(snapshot.target)]: snapshot } };
      }
      const saved = state.drafts[cellDraftKey(snapshot.target)];
      return sameSession(saved ?? null, snapshot)
        ? { ...state, drafts: { ...state.drafts, [cellDraftKey(snapshot.target)]: snapshot } }
        : state;
    }
    case 'commit':
      return state.editing && sameSession(state.editing, action.session)
        ? { ...state, editing: null, drafts: withoutDraft(state.drafts, state.editing.target) } : state;
    case 'cancel':
      return state.editing && sameSession(state.editing, action.session)
        ? withFocusRequest({ ...state, editing: null, drafts: withoutDraft(state.drafts, state.editing.target) }, state.editing.target) : state;
    case 'clear':
      // Clearing contents is not a selection operation. Keep a range (including
      // a whole-row or whole-column selection) intact for subsequent navigation.
      if (sameTarget(state.selection, action.target)) {
        return withFocusRequest({
          ...state,
          selectionsBySheet: { ...state.selectionsBySheet, [action.target.sheetId]: action.target },
          ...suspendEdit(state),
          referenceSelection: null,
        }, action.target);
      }
      return withFocusRequest({
        ...state,
        selection: action.target,
        selectionsBySheet: { ...state.selectionsBySheet, [action.target.sheetId]: action.target },
        selectionOwner: null,
        rangeSelection: { mode: 'cells', anchor: action.target, extent: action.target },
        ...suspendEdit(state),
        referenceSelection: null,
        tabRunOriginColumnId: null,
      }, action.target);
    case 'navigate':
      return withFocusRequest({
        ...state,
        selection: action.target,
        selectionsBySheet: { ...state.selectionsBySheet, [action.target.sheetId]: action.target },
        selectionOwner: null,
        rangeSelection: { mode: 'cells', anchor: action.target, extent: action.target },
        ...suspendEdit(state),
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
        selectionsBySheet: { ...state.selectionsBySheet, [action.target.sheetId]: action.target },
        selectionOwner: null,
        ...suspendEdit(state),
        referenceSelection: null,
        tabRunOriginColumnId: null,
      }, action.target);
    case 'commit-tab':
      return withFocusRequest({
        ...state,
        selection: action.target,
        selectionsBySheet: { ...state.selectionsBySheet, [action.target.sheetId]: action.target },
        selectionOwner: null,
        rangeSelection: { mode: 'cells', anchor: action.target, extent: action.target },
        ...suspendEdit(state),
        referenceSelection: null,
        tabRunOriginColumnId: action.originColumnId,
      }, action.target);
    case 'commit-enter':
      return withFocusRequest({
        ...state,
        selection: action.target,
        selectionsBySheet: { ...state.selectionsBySheet, [action.target.sheetId]: action.target },
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
    case 'cancel-focus':
      // Cancellation can race with a replacement request. Only the owner of the
      // exact request may release its focus and virtualization pin.
      return state.focusRequest?.id === action.requestId ? { ...state, focusRequest: null } : state;
    case 'clear-selection':
      return { ...state, selection: null, selectionOwner: null, rangeSelection: null, ...suspendEdit(state), focusRequest: null, referenceSelection: null, tabRunOriginColumnId: null };
    case 'reconcile-selection':
      return reconcileCellSelection(state, action.sheets);
    case 'prune-sheets': {
      const keep = (target: CellTarget | null) => target && action.sheetIds.has(target.sheetId) ? target : null;
      const referenceSelection = state.referenceSelection
        && action.sheetIds.has(referenceStart(state.referenceSelection).sheetId)
        ? state.referenceSelection
        : null;
      return {
        ...state,
        selection: keep(state.selection),
        selectionsBySheet: Object.fromEntries(Object.entries(state.selectionsBySheet).filter(([sheetId]) => action.sheetIds.has(sheetId))),
        selectionOwner: keep(state.selection) ? state.selectionOwner : null,
        rangeSelection: state.rangeSelection && action.sheetIds.has(state.rangeSelection.anchor.sheetId)
          ? state.rangeSelection : null,
        editing: state.editing && action.sheetIds.has(state.editing.target.sheetId) ? state.editing : null,
        drafts: Object.fromEntries(Object.entries(state.drafts).filter(([, draft]) => action.sheetIds.has(draft.target.sheetId))),
        focusRequest: state.focusRequest && keep(state.focusRequest.target) ? state.focusRequest : null,
        referenceSelection,
      };
    }
    case 'prune-drafts': {
      const drafts = Object.fromEntries(Object.entries(state.drafts).filter(([key]) => action.targetKeys.has(key)));
      const editing = state.editing && action.targetKeys.has(cellDraftKey(state.editing.target)) ? state.editing : null;
      return { ...state, drafts, editing };
    }
  }
}

export function cellDraftKey(target: CellTarget) {
  return formulaDraftKey(target);
}

function withoutDraft(drafts: Readonly<Record<string, CellEditSession>>, target: CellTarget) {
  return Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== cellDraftKey(target)));
}

function suspendEdit(state: CellInteractionState) {
  if (!state.editing) return { editing: null };
  return { editing: null, drafts: { ...state.drafts, [cellDraftKey(state.editing.target)]: state.editing } };
}

function normalizeSnapshot(session: CellEditSession): CellEditSession {
  return {
    ...session,
    selection: session.selection ?? { start: session.draft.length, end: session.draft.length },
    scrollTop: session.scrollTop ?? 0,
  };
}

function sameSession(left: CellEditSession | null, right: CellEditSession) {
  return Boolean(left && sameTarget(left.target, right.target) && left.sessionId === right.sessionId);
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

export function sameSelectionIdentity(left: CellSelection | null, right: CellSelection | null): boolean {
  if (!left || !right) return left === right;
  if (left.mode !== right.mode || !sameTarget(left.anchor, right.anchor) || !sameTarget(left.extent, right.extent)) return false;
  const a = left.members;
  const b = right.members;
  return !a && !b || Boolean(a && b && a.length === b.length && a.every((id) => b.includes(id)));
}

function reconcileCellSelection(state: CellInteractionState, sheets: readonly SheetDocument[], partial = false): CellInteractionState {
  const sheetById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const valid = (target: CellTarget | null) => {
    const sheet = target && sheetById.get(target.sheetId);
    return Boolean(sheet && cellKeyForTarget(sheet, target));
  };
  const first = (sheet: SheetDocument): CellTarget | null => {
    const rowId = sheet.content.rows[0];
    const columnId = sheet.content.columns[0];
    return rowId && columnId ? { sheetId: sheet.id, cell: { rowId, columnId } } : null;
  };
  const remembered = Object.fromEntries(Object.entries(state.selectionsBySheet).flatMap(([id, target]) => {
    const sheet = sheetById.get(id);
    const next = !sheet && partial ? target : valid(target) ? target : sheet && first(sheet);
    return next ? [[id, next]] : [];
  }));
  let selection = state.selection;
  let range = state.rangeSelection;
  const sheet = selection && sheetById.get(selection.sheetId);
  if (sheet && range && range.mode !== 'cells' && range.members) {
    const pruned = pruneAxisSelection(sheet, { ...range, mode: range.mode, members: range.members });
    if (pruned && projectSelection(sheet, pruned)) {
      range = pruned;
      selection = pruned.extent;
    } else {
      selection = first(sheet);
      range = selection ? { mode: 'cells', anchor: selection, extent: selection } : null;
    }
  } else if (!valid(selection) || (range && (!sheet || !projectSelection(sheet, range)))) {
    selection = sheet ? first(sheet) : null;
    range = selection ? { mode: 'cells', anchor: selection, extent: selection } : null;
  }
  if (selection) remembered[selection.sheetId] = selection;
  const changed = !sameSelectionIdentity(state.rangeSelection, range)
    || !((!state.selection && !selection) || sameTarget(state.selection, selection));
  return {
    ...state, selection, rangeSelection: range, selectionsBySheet: remembered,
    selectionOwner: changed ? null : state.selectionOwner,
    focusRequest: state.focusRequest && (valid(state.focusRequest.target) || (partial && !sheetById.has(state.focusRequest.target.sheetId))) ? state.focusRequest : null,
  };
}
