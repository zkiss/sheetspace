import {
  cellAddressOf,
  cellIdentityAt,
  cellKey,
  type SheetDocument,
  type SheetTabularProjection,
} from './workbook';
import type { CellEditSession, CellTarget, ReferenceNavigationTarget } from './appTypes';

export type CellInteractionState = {
  selection: CellTarget | null;
  editing: CellEditSession | null;
  focusRequest: CellTarget | null;
  referenceSelection: ReferenceNavigationTarget | null;
  tabRunOriginColumnId: string | null;
};

export const EMPTY_CELL_INTERACTION_STATE: CellInteractionState = {
  selection: null,
  editing: null,
  focusRequest: null,
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
      return {
        ...state,
        selection: target,
        editing: null,
        focusRequest: target,
        referenceSelection: action.target,
        tabRunOriginColumnId: null,
      };
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
      return { ...state, editing: null, focusRequest: state.editing?.target ?? state.focusRequest };
    case 'clear':
    case 'navigate':
      return {
        ...state,
        selection: action.target,
        editing: null,
        focusRequest: action.target,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      };
    case 'commit-tab':
      return {
        ...state,
        selection: action.target,
        editing: null,
        focusRequest: action.target,
        referenceSelection: null,
        tabRunOriginColumnId: action.originColumnId,
      };
    case 'commit-enter':
      return {
        ...state,
        selection: action.target,
        editing: null,
        focusRequest: action.target,
        referenceSelection: null,
        tabRunOriginColumnId: null,
      };
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
        focusRequest: keep(state.focusRequest),
        referenceSelection,
      };
    }
  }
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
