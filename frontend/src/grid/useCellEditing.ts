import { useEffect, useReducer, useRef } from 'react';
import { cellAddressOf, cellIdentityFromKey } from '@workbook/core/cellIdentity';
import { cellRawContent, findSheetById, sheetsInOrder } from '@workbook/read/queries';
import { projectStoredFormula } from '@workbook/formula/storedFormulaProjection';
import { decodeCellTextLiteral } from '@workbook/core/cellLiteral';
import { type SheetDocument, type Workbook } from '@workbook/core/model';
import { isCalculatedOwnedColumn } from '@workbook/core/calculatedOwnership';
import type { CellWriteResult } from '@application/core/userActions';
import type {
  SelectionGesture,
  CellEditSession,
  CellSelectionMode,
  CellContentCommands,
  CellNavigationDirection,
  CellNavigationRequest,
  CellTarget,
  ReferenceNavigationTarget,
  CellSelection,
} from './cellInteractionContracts';
import { resolveCellNavigation } from './cellNavigation';
import {
  cellInteractionReducer,
  cellDraftKey,
  cellKeyForTarget,
  EMPTY_CELL_INTERACTION_STATE,
  sameTarget,
} from '@grid/cellInteraction';

function adjacentTarget(
  sheet: SheetDocument,
  target: CellTarget,
  delta: { columnIndex: number; rowIndex: number },
): CellTarget | undefined {
  const content = sheet.content;
  const address = cellAddressOf(content, target.cell);
  if (!address) return undefined;
  const rowIndex = Math.min(content.rows.length - 1, Math.max(0, address.rowIndex + delta.rowIndex));
  const columnIndex = Math.min(content.columns.length - 1, Math.max(0, address.columnIndex + delta.columnIndex));
  const rowId = content.rows[rowIndex];
  const columnId = content.columns[columnIndex];
  return rowId === undefined || columnId === undefined
    ? undefined
    : { sheetId: sheet.id, cell: { rowId, columnId } };
}

export function useCellEditing({
  commands,
  workbook,
}: {
  commands: CellContentCommands;
  workbook: Workbook;
}) {
  const [state, dispatchInteraction] = useReducer(cellInteractionReducer, EMPTY_CELL_INTERACTION_STATE);
  const interactionRevision = useRef(0);
  function dispatch(action: Parameters<typeof cellInteractionReducer>[1]) {
    if (['select', 'extend-selection', 'select-axis', 'select-reference', 'restore-selection', 'clear-selection',
      'activate-sheet', 'navigate', 'traverse-range', 'commit-tab', 'commit-enter', 'start-edit'].includes(action.type)) {
      interactionRevision.current += 1;
    }
    dispatchInteraction(action);
  }
  const stateRef = useRef(state);
  const activeSessionRef = useRef<CellEditSession | null>(state.editing);
  stateRef.current = state;
  activeSessionRef.current = state.editing;
  const committedDrafts = useRef(new Set<string>());
  const nextSessionId = useRef(1);

  function draftKey(session: CellEditSession) {
    return `${session.target.sheetId}:${session.target.cell.rowId}:${session.target.cell.columnId}:${session.draft}`;
  }

  useEffect(() => {
    dispatch({
      type: 'prune-sheets',
      sheetIds: new Set(sheetsInOrder(workbook).map((sheet) => sheet.id)),
    });
  }, [workbook]);

  useEffect(() => {
    const targetKeys = new Set(
      sheetsInOrder(workbook).flatMap((sheet) => sheet.content.rows.flatMap((rowId) => sheet.content.columns
        .filter((columnId) => !isCalculatedOwnedColumn(workbook, sheet.id, columnId))
        .map((columnId) => cellDraftKey({ sheetId: sheet.id, cell: { rowId, columnId } })))),
    );
    dispatch({ type: 'prune-drafts', targetKeys });
  }, [workbook]);

  useEffect(() => {
    if (state.editing && !state.editing.readOnly && isCalculatedOwnedColumn(workbook, state.editing.target.sheetId, state.editing.target.cell.columnId)) {
      dispatch({ type: 'cancel', session: state.editing });
    }
  }, [state.editing, workbook]);

  function commitSession(session: CellEditSession | null): CellWriteResult | undefined {
    if (!session) return undefined;
    if (session.readOnly) return undefined;
    const sheet = findSheetById(workbook, session.target.sheetId);
    const key = sheet && cellKeyForTarget(sheet, session.target);
    if (!sheet || !key) return undefined;

    const currentCell = cellRawContent(sheet, key);
    const currentRaw = currentCell ?? '';
    const currentEditValue = decodeCellTextLiteral(currentRaw) ?? (currentCell?.startsWith('=') ? projectStoredFormula(currentCell, workbook, sheet.id).text : currentRaw);
    if (currentEditValue !== session.draft) {
      const draftSignature = draftKey(session);
      if (!committedDrafts.current.has(draftSignature)) {
        const outcome = commands.updateCellContent(session.target.sheetId, key, session.draft);
        if (!outcome || outcome.ok) committedDrafts.current.add(draftSignature);
        return outcome;
      }
    }
    return undefined;
  }

  function commitActiveEdit(session = stateRef.current.editing ?? activeSessionRef.current) {
    if (!session || !sameSession(stateRef.current.editing, session)) return undefined;
    const outcome = commitSession(session);
    if (!outcome || outcome.ok) dispatch({ type: 'commit', session });
    return outcome;
  }

  function suspendActiveEdit(session: CellEditSession) {
    // This deliberately also dispatches after navigation has ended activity:
    // the reducer admits only the matching suspended generation.
    dispatch({ type: 'suspend', session });
  }

  function startEditingCell(target: CellTarget, initialValue?: string) {
    const readOnly = isCalculatedOwnedColumn(workbook, target.sheetId, target.cell.columnId);
    if (readOnly && initialValue !== undefined) return;
    const sheet = findSheetById(workbook, target.sheetId);
    const key = sheet && cellKeyForTarget(sheet, target);
    if (!sheet || !key) return;
    committedDrafts.current.clear();
    // A rich-panel handoff is a new DOM callback lifetime, not a new draft.
    // Seed it from the live session before the reducer transfers ownership.
    const active = stateRef.current.editing;
    const transfer = initialValue === undefined && active && sameTarget(active.target, target)
      ? active
      : undefined;
    const raw = cellRawContent(sheet, key);
    const session = {
      target,
      readOnly,
      draft: initialValue ?? transfer?.draft ?? (raw ? decodeCellTextLiteral(raw) ?? (raw.startsWith('=') ? projectStoredFormula(raw, workbook, sheet.id).text : raw) : ''),
      selection: transfer?.selection,
      scrollTop: transfer?.scrollTop,
      sessionId: nextSessionId.current++,
    };
    activeSessionRef.current = session;
    dispatch({
      type: 'start-edit',
      replaceSuspendedDraft: initialValue !== undefined || readOnly,
      session,
    });
  }

  function clearCellContent(target: CellTarget): CellWriteResult | undefined {
    if (isCalculatedOwnedColumn(workbook, target.sheetId, target.cell.columnId)) {
      return { ok: false, reason: 'calculated-cell-write' };
    }
    const sheet = findSheetById(workbook, target.sheetId);
    if (!sheet) return undefined;
    const selection = state.rangeSelection?.anchor.sheetId === target.sheetId
      ? state.rangeSelection
      : null;
    const targetAddress = cellAddressOf(sheet.content, target.cell);
    const anchor = selection ? cellAddressOf(sheet.content, selection.anchor.cell) : targetAddress;
    const extent = selection ? cellAddressOf(sheet.content, selection.extent.cell) : targetAddress;
    const start = anchor && extent ? {
      columnIndex: selection?.mode === 'rows' ? 0 : Math.min(anchor.columnIndex, extent.columnIndex),
      rowIndex: selection?.mode === 'columns' ? 0 : Math.min(anchor.rowIndex, extent.rowIndex),
    } : undefined;
    const end = anchor && extent ? {
      columnIndex: selection?.mode === 'rows' ? sheet.content.columns.length - 1 : Math.max(anchor.columnIndex, extent.columnIndex),
      rowIndex: selection?.mode === 'columns' ? sheet.content.rows.length - 1 : Math.max(anchor.rowIndex, extent.rowIndex),
    } : undefined;
    const writes = Object.entries(sheet.content.cells).flatMap(([identityKey, raw]) => {
      if (!raw) return [];
      const identity = cellIdentityFromKey(identityKey);
      const address = identity && cellAddressOf(sheet.content, identity);
      if (!identity || !address || (start && end && (
        address.columnIndex < start.columnIndex || address.columnIndex > end.columnIndex
        || address.rowIndex < start.rowIndex || address.rowIndex > end.rowIndex
      ))) return [];
      return [{ sheetId: sheet.id, ...identity, raw: '' }];
    });
    if (writes.length > 0) {
      const outcome = commands.writeCells(writes);
      // A rejected clear leaves the workbook and the selection untouched, and the
      // caller reports the rejection instead of presenting a silent no-op.
      if (outcome && !outcome.ok) return outcome;
    }
    dispatch({ type: 'clear', target });
    return undefined;
  }

  function activateSheet(sheetId: string, requestFocus = true) {
    const sheet = findSheetById(workbook, sheetId);
    if (!sheet) return undefined;
    const remembered = state.selectionsBySheet[sheetId];
    const target = remembered && cellKeyForTarget(sheet, remembered) ? remembered : (sheet.content.rows[0] && sheet.content.columns[0]
      ? { sheetId, cell: { rowId: sheet.content.rows[0], columnId: sheet.content.columns[0] } }
      : undefined);
    if (!target) return undefined;
    if (state.selection?.sheetId === sheetId && cellKeyForTarget(sheet, state.selection)) {
      if (requestFocus) dispatch({ type: 'focus-current-selection' });
    } else dispatch({ type: 'activate-sheet', target, requestFocus });
    return target;
  }

  function navigateCell(target: CellTarget, direction: CellNavigationDirection, extend = false) {
    const sheet = findSheetById(workbook, target.sheetId);
    if (!sheet) return;
    const delta = {
      left: { columnIndex: -1, rowIndex: 0 },
      right: { columnIndex: 1, rowIndex: 0 },
      up: { columnIndex: 0, rowIndex: -1 },
      down: { columnIndex: 0, rowIndex: 1 },
    } satisfies Record<CellNavigationDirection, { columnIndex: number; rowIndex: number }>;
    const next = adjacentTarget(sheet, target, delta[direction]);
    if (next) dispatch(extend
      ? { type: 'extend-selection', target: next, requestFocus: true }
      : { type: 'navigate', target: next });
  }

  function navigateKeyboardCell(target: CellTarget, request: CellNavigationRequest) {
    const sheet = findSheetById(workbook, target.sheetId);
    if (!sheet) return false;
    const next = resolveCellNavigation(sheet, target, state.rangeSelection, request);
    if (!next) return false;
    const selection = state.rangeSelection;
    const traversesRectangle = (request.key === 'Tab' || request.key === 'Enter')
      && selection?.mode === 'cells'
      && selection.anchor.sheetId === sheet.id
      && selection.extent.sheetId === sheet.id
      && (() => {
        const anchor = cellAddressOf(sheet.content, selection.anchor.cell);
        const extent = cellAddressOf(sheet.content, selection.extent.cell);
        return Boolean(anchor && extent
          && (anchor.rowIndex !== extent.rowIndex || anchor.columnIndex !== extent.columnIndex));
      })();
    // Whole-axis traversal deliberately uses ordinary navigation. In
    // particular, Shift must not retain row/column selection semantics.
    dispatch(traversesRectangle
      ? { type: 'traverse-range', target: next }
      // Shift extends selection for directional navigation only. Tab and Enter
      // are traversal commands even when a single cell is selected.
      : request.shift && request.key !== 'Tab' && request.key !== 'Enter' && selection?.mode === 'cells'
        ? { type: 'extend-selection', target: next, requestFocus: true }
        : { type: 'navigate', target: next });
    return true;
  }

  function commitEditAndNavigate(
    session: CellEditSession,
    request: Pick<CellNavigationRequest, 'key' | 'shift'> | 'tab' | 'enter',
  ): CellWriteResult | undefined {
    const normalizedRequest = typeof request === 'string'
      ? { key: request === 'tab' ? 'Tab' as const : 'Enter' as const }
      : request;
    if (!sameSession(stateRef.current.editing, session)) return undefined;
    const outcome = commitSession(session);
    if (outcome && !outcome.ok) return outcome;
    dispatch({ type: 'commit', session });
    const sheet = findSheetById(workbook, session.target.sheetId);
    const selection = state.rangeSelection;
    const hasRectangle = Boolean(sheet && selection?.mode === 'cells'
      && selection.anchor.sheetId === sheet.id && selection.extent.sheetId === sheet.id
      && (() => {
        const anchor = cellAddressOf(sheet.content, selection.anchor.cell);
        const extent = cellAddressOf(sheet.content, selection.extent.cell);
        return anchor && extent && (anchor.rowIndex !== extent.rowIndex || anchor.columnIndex !== extent.columnIndex);
      })());
    if (!sheet || normalizedRequest.shift || hasRectangle) {
      navigateKeyboardCell(session.target, normalizedRequest);
      return outcome;
    }

    // A single-cell edit retains established fill-across behavior: Enter after
    // a run of Tab commits continues on the next row at the run's origin.
    if (normalizedRequest.key === 'Tab') {
      const next = adjacentTarget(sheet, session.target, { columnIndex: 1, rowIndex: 0 });
      if (next) dispatch({
        type: 'commit-tab',
        target: next,
        originColumnId: state.tabRunOriginColumnId ?? session.target.cell.columnId,
      });
      return outcome;
    }
    const originColumnId = state.tabRunOriginColumnId ?? session.target.cell.columnId;
    const originColumnIndex = sheet.content.columns.indexOf(originColumnId);
    const originTarget = originColumnIndex < 0 ? session.target : {
      sheetId: sheet.id,
      cell: { rowId: session.target.cell.rowId, columnId: sheet.content.columns[originColumnIndex] },
    };
    const next = adjacentTarget(sheet, originTarget, { columnIndex: 0, rowIndex: 1 });
    if (next) dispatch({ type: 'commit-enter', target: next });
    return outcome;
  }

  return {
    interactionRevision: () => interactionRevision.current,
    activeCell: state.selection,
    activateSheet,
    cancelActiveEdit: (session = stateRef.current.editing ?? activeSessionRef.current) => {
      if (session) dispatch({ type: 'cancel', session });
    },
    clearCellContent,
    clearSelection: () => dispatch({ type: 'clear-selection' }),
    commitActiveEdit,
    suspendActiveEdit,
    commitEditAndNavigate,
    editingCell: state.editing,
    drafts: state.drafts,
    acknowledgeKeyboardFocusRequest: (requestId: number) => dispatch({ type: 'acknowledge-focus', requestId }),
    cancelKeyboardFocusRequest: (requestId: number) => dispatch({ type: 'cancel-focus', requestId }),
    keyboardFocusRequest: state.focusRequest,
    navigateCell,
    navigateKeyboardCell,
    referenceSelection: state.referenceSelection,
    selectionRange: state.rangeSelection,
    selectionOwner: state.selectionOwner,
    selectCell: (target: CellTarget, gesture?: SelectionGesture) => dispatch({ type: 'select', target, gesture }),
    extendSelection: (target: CellTarget, gesture?: SelectionGesture) => dispatch({ type: 'extend-selection', target, gesture }),
    focusSelection: (target: CellTarget, gesture?: SelectionGesture) => dispatch({ type: 'extend-selection', target, requestFocus: true, gesture }),
    settleSelectionGesture: (owner: symbol) => dispatch({ type: 'settle-selection-gesture', gesture: { owner } }),
    focusCurrentSelection: () => {
      if (!state.selection) return null;
      const requestId = state.nextFocusRequestId;
      dispatch({ type: 'focus-current-selection' });
      return requestId;
    },
    selectAxis: (mode: Exclude<CellSelectionMode, 'cells'>, target: CellTarget, extend: boolean, gesture?: SelectionGesture) => {
      dispatch({ type: 'select-axis', mode, target, extend, gesture });
    },
    selectReferenceTarget: (target: ReferenceNavigationTarget) => dispatch({ type: 'select-reference', target }),
    restoreSelection: (selection: CellSelection | null) => {
      if (!selection) {
        dispatch({ type: 'restore-selection', selection: null });
        return true;
      }
      const sheet = findSheetById(workbook, selection.anchor.sheetId);
      const valid = sheet && selection.anchor.sheetId === selection.extent.sheetId
        && cellKeyForTarget(sheet, selection.anchor) && cellKeyForTarget(sheet, selection.extent);
      if (!valid) {
        dispatch({ type: 'restore-selection', selection: null });
        return false;
      }
      dispatch({ type: 'restore-selection', selection });
      return true;
    },
    startEditingCell,
    updateEditingCellValue: (draft: string, session = stateRef.current.editing ?? activeSessionRef.current) => {
      if (!session || session.readOnly) return;
      committedDrafts.current.clear();
      dispatch({ type: 'update-draft', session, draft });
    },
    updateEditingCellView: (selection: { start: number; end: number }, scrollTop: number, session = stateRef.current.editing ?? activeSessionRef.current) => {
      if (!session) return;
      dispatch({ type: 'update-editor-state', session, selection, scrollTop });
    },
  };
}

function sameSession(active: CellEditSession | null, candidate: CellEditSession) {
  return Boolean(active && active.target.sheetId === candidate.target.sheetId
    && active.target.cell.rowId === candidate.target.cell.rowId
    && active.target.cell.columnId === candidate.target.cell.columnId
    && active.sessionId === candidate.sessionId);
}
