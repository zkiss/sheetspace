import { useEffect, useReducer } from 'react';
import {
  cellAddressOf,
  cellRawContent,
  findSheetById,
  formulaRawForDisplay,
  sheetsInOrder,
  type SheetDocument,
  type SheetTabularProjection,
  type Workbook,
} from './workbook';
import type {
  CellEditSession,
  CellNavigationDirection,
  CellTarget,
  ReferenceNavigationTarget,
} from './appTypes';
import {
  cellInteractionReducer,
  cellKeyForTarget,
  EMPTY_CELL_INTERACTION_STATE,
} from './cellInteraction';
import type { WorkbookCommands } from './useWorkbookController';


function adjacentTarget(
  sheet: SheetDocument | SheetTabularProjection,
  target: CellTarget,
  delta: { columnIndex: number; rowIndex: number },
): CellTarget | undefined {
  const content = 'content' in sheet ? sheet.content : sheet;
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
  commands: Pick<WorkbookCommands, 'updateCellContent'>;
  workbook: Workbook;
}) {
  const [state, dispatch] = useReducer(cellInteractionReducer, EMPTY_CELL_INTERACTION_STATE);

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
    if (
      currentEditValue !== session.draft
      || (currentCell && currentRaw.length === 0 && session.draft.length === 0)
    ) {
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
    const key = sheet && cellKeyForTarget(sheet, target);
    if (sheet && key && cellRawContent(sheet, key)) {
      commands.updateCellContent(target.sheetId, key, '');
    }
  }

  function navigateCell(target: CellTarget, direction: CellNavigationDirection) {
    const sheet = findSheetById(workbook, target.sheetId);
    if (!sheet) return;
    const delta = {
      left: { columnIndex: -1, rowIndex: 0 },
      right: { columnIndex: 1, rowIndex: 0 },
      up: { columnIndex: 0, rowIndex: -1 },
      down: { columnIndex: 0, rowIndex: 1 },
    } satisfies Record<CellNavigationDirection, { columnIndex: number; rowIndex: number }>;
    const next = adjacentTarget(sheet, target, delta[direction]);
    if (next) dispatch({ type: 'navigate', target: next });
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
    selectCell: (target: CellTarget) => dispatch({ type: 'select', target }),
    selectReferenceTarget: (target: ReferenceNavigationTarget) => dispatch({ type: 'select-reference', target }),
    startEditingCell,
    updateEditingCellValue: (draft: string) => dispatch({ type: 'update-draft', draft }),
  };
}
