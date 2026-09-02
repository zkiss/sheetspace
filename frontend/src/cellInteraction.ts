import { cellAddressOf, cellIdentityAt } from './workbook/core/cellIdentity';
import { cellKey } from './workbook/core/address';
import { type SheetDocument, type SheetTabularProjection } from './workbook/core/model';
import type { CellEditSession, CellTarget, ReferenceNavigationTarget } from './appTypes';

export type CellInteractionState = {
  selection: CellTarget | null;
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
  editing: null,
  focusRequest: null,
  nextFocusRequestId: 1,
  referenceSelection: null,
  tabRunOriginColumnId: null,
};

export type CellInteractionAction =
  | { type: 'select'; target: CellTarget }
  | { type: 'select-reference'; target: ReferenceNavigationTarget }
  | { type: 'start-edit'; session: CellEditSession }
  | { type: 'update-draft'; draft: string }
  | { type: 'commit' }
  | { type: 'cancel' }
  | { type: 'clear'; target: CellTarget }
  | { type: 'navigate'; target: CellTarget }
  | { type: 'commit-tab'; target: CellTarget; originColumnId: string }
  | { type: 'commit-enter'; target: CellTarget }
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
  switch (action.type) {
    case 'select':
      return {
        ...state,
        selection: action.target,
        focusRequest: null,
        referenceSelection: null,
        tabRunOriginColumnId: sameTarget(state.selection, action.target) ? state.tabRunOriginColumnId : null,
      };
    case 'select-reference': {
      const target = referenceStart(action.target);
      return withFocusRequest({
        ...state,
        selection: target,
        editing: null,
        referenceSelection: action.target,
        tabRunOriginColumnId: null,
      }, target);
    }
    case 'start-edit':
      return {
        ...state,
        selection: action.session.target,
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
    case 'navigate':
      return withFocusRequest({
        ...state,
        selection: action.target,
        editing: null,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      }, action.target);
    case 'commit-tab':
      return withFocusRequest({
        ...state,
        selection: action.target,
        editing: null,
        referenceSelection: null,
        tabRunOriginColumnId: action.originColumnId,
      }, action.target);
    case 'commit-enter':
      return withFocusRequest({
        ...state,
        selection: action.target,
        editing: null,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      }, action.target);
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
        editing: state.editing && action.sheetIds.has(state.editing.target.sheetId) ? state.editing : null,
        focusRequest: state.focusRequest && keep(state.focusRequest.target) ? state.focusRequest : null,
        referenceSelection,
      };
    }
  }
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
