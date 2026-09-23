import { useEffect, useReducer, useRef } from 'react';
import { cellAddressOf, cellIdentityFromKey } from '@workbook/core/cellIdentity';
import { cellRawContent, findSheetById, sheetsInOrder } from '@workbook/read/queries';
import { formulaRawForDisplay } from '@workbook/formula/reference';
import { type SheetDocument, type Workbook } from '@workbook/core/model';
import type {
  SelectionGesture,
  CellEditSession,
  CellSelectionMode,
  CellContentCommands,
  CellNavigationDirection,
  CellTarget,
  ReferenceNavigationTarget,
} from './cellInteractionContracts';
import {
  cellInteractionReducer,
  cellKeyForTarget,
  EMPTY_CELL_INTERACTION_STATE,
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
  const [state, dispatch] = useReducer(cellInteractionReducer, EMPTY_CELL_INTERACTION_STATE);
  const committedDrafts = useRef(new Set<string>());

  function draftKey(session: CellEditSession) {
    return `${session.target.sheetId}:${session.target.cell.rowId}:${session.target.cell.columnId}:${session.draft}`;
  }

  useEffect(() => {
    dispatch({
      type: 'prune-sheets',
      sheetIds: new Set(sheetsInOrder(workbook).map((sheet) => sheet.id)),
    });
  }, [workbook.manifest.sheetIds]);

  function commitSession(session: CellEditSession | null) {
    if (!session) return;
    const sheet = findSheetById(workbook, session.target.sheetId);
    const key = sheet && cellKeyForTarget(sheet, session.target);
    if (!sheet || !key) return;

    const currentCell = cellRawContent(sheet, key);
    const currentRaw = currentCell ?? '';
    const currentEditValue = currentCell ? formulaRawForDisplay(currentCell, workbook, sheet.id) : currentRaw;
    if (currentEditValue !== session.draft) {
      const draftSignature = draftKey(session);
      if (committedDrafts.current.has(draftSignature)) return;
      committedDrafts.current.add(draftSignature);
      commands.updateCellContent(session.target.sheetId, key, session.draft);
    }
  }

  function commitActiveEdit(session = state.editing) {
    commitSession(session);
    dispatch({ type: 'commit' });
  }

  function startEditingCell(target: CellTarget, initialValue?: string) {
    const sheet = findSheetById(workbook, target.sheetId);
    const key = sheet && cellKeyForTarget(sheet, target);
    if (!sheet || !key) return;
    committedDrafts.current.clear();
    const raw = cellRawContent(sheet, key);
    dispatch({
      type: 'start-edit',
      session: {
        target,
        draft: initialValue ?? (raw ? formulaRawForDisplay(raw, workbook, sheet.id) : ''),
      },
    });
  }

  function clearCellContent(target: CellTarget) {
    dispatch({ type: 'clear', target });
    const sheet = findSheetById(workbook, target.sheetId);
    if (!sheet) return;
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
    if (writes.length > 0) commands.writeCells(writes);
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

  function commitEditAndNavigate(session: CellEditSession, direction: 'tab' | 'enter') {
    const sheet = findSheetById(workbook, session.target.sheetId);
    const address = sheet && cellAddressOf(sheet.content, session.target.cell);
    if (!sheet || !address) {
      commitActiveEdit(session);
      return;
    }
    commitSession(session);

    if (direction === 'tab') {
      const next = adjacentTarget(sheet, session.target, { columnIndex: 1, rowIndex: 0 });
      if (next) {
        dispatch({
          type: 'commit-tab',
          target: next,
          originColumnId: state.tabRunOriginColumnId ?? session.target.cell.columnId,
        });
      }
      return;
    }

    const originColumnId = state.tabRunOriginColumnId ?? session.target.cell.columnId;
    const originColumnIndex = sheet.content.columns.indexOf(originColumnId);
    const originTarget = originColumnIndex < 0
      ? session.target
      : {
          sheetId: sheet.id,
          cell: {
            rowId: session.target.cell.rowId,
            columnId: sheet.content.columns[originColumnIndex],
          },
        };
    const next = adjacentTarget(sheet, originTarget, { columnIndex: 0, rowIndex: 1 });
    if (next) dispatch({ type: 'commit-enter', target: next });
  }

  return {
    activeCell: state.selection,
    cancelActiveEdit: () => dispatch({ type: 'cancel' }),
    clearCellContent,
    commitActiveEdit,
    commitEditAndNavigate,
    editingCell: state.editing,
    acknowledgeKeyboardFocusRequest: (requestId: number) => dispatch({ type: 'acknowledge-focus', requestId }),
    keyboardFocusRequest: state.focusRequest,
    navigateCell,
    referenceSelection: state.referenceSelection,
    selectionRange: state.rangeSelection,
    selectionOwner: state.selectionOwner,
    selectCell: (target: CellTarget, gesture?: SelectionGesture) => dispatch({ type: 'select', target, gesture }),
    extendSelection: (target: CellTarget, gesture?: SelectionGesture) => dispatch({ type: 'extend-selection', target, gesture }),
    focusSelection: (target: CellTarget, gesture?: SelectionGesture) => dispatch({ type: 'extend-selection', target, requestFocus: true, gesture }),
    focusCurrentSelection: () => dispatch({ type: 'focus-current-selection' }),
    selectAxis: (mode: Exclude<CellSelectionMode, 'cells'>, target: CellTarget, extend: boolean, gesture?: SelectionGesture) => {
      if (!gesture || gesture.start) commitActiveEdit();
      dispatch({ type: 'select-axis', mode, target, extend, gesture });
    },
    selectReferenceTarget: (target: ReferenceNavigationTarget) => dispatch({ type: 'select-reference', target }),
    startEditingCell,
    updateEditingCellValue: (draft: string) => {
      committedDrafts.current.clear();
      dispatch({ type: 'update-draft', draft });
    },
  };
}
