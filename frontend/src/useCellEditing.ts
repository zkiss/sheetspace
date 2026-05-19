import { Dispatch, SetStateAction, useRef, useState } from 'react';
import type { WorkbookApi } from './workbookApi';
import {
  cellKey,
  commitCellRawContent,
  parseA1Address,
  type CellAddress,
  type Sheet,
  type Workbook,
} from './workbook';
import type { ActiveCellSelection, CellNavigationDirection, EditingCell } from './appTypes';

function clampedCellAddress(
  sheet: Sheet,
  address: CellAddress,
  delta: { columnIndex: number; rowIndex: number },
): CellAddress {
  return {
    columnIndex: Math.min(sheet.columnCount - 1, Math.max(0, address.columnIndex + delta.columnIndex)),
    rowIndex: Math.min(sheet.rowCount - 1, Math.max(0, address.rowIndex + delta.rowIndex)),
  };
}

export function useCellEditing({
  enqueueEdit,
  getApiMethod,
  runRevisionedEdit,
  setWorkbook,
  workbook,
}: {
  enqueueEdit: (key: string, run: () => Promise<Workbook>) => void;
  getApiMethod: <K extends keyof WorkbookApi>(method: K) => WorkbookApi[K];
  runRevisionedEdit: (
    sheetId: string,
    save: (revision: number | undefined) => Promise<Workbook>,
  ) => Promise<Workbook>;
  setWorkbook: Dispatch<SetStateAction<Workbook>>;
  workbook: Workbook;
}) {
  const [activeCell, setActiveCell] = useState<ActiveCellSelection | null>(null);
  const [keyboardFocusTarget, setKeyboardFocusTarget] = useState<ActiveCellSelection | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const tabRunOriginColumn = useRef<number | null>(null);

  function commitActiveEdit(editToCommit = editingCell) {
    if (!editToCommit) {
      return;
    }

    const currentSheet = workbook.sheets.find((sheet) => sheet.id === editToCommit.sheetId);
    const currentRaw = currentSheet?.cells[editToCommit.cellKey]?.raw ?? '';
    const nextWorkbook = commitCellRawContent(workbook, editToCommit.sheetId, editToCommit.cellKey, editToCommit.value);

    if (nextWorkbook !== workbook) {
      setWorkbook(nextWorkbook);
    }
    if (nextWorkbook !== workbook && currentRaw !== editToCommit.value) {
      enqueueEdit(`cell:${editToCommit.sheetId}:${editToCommit.cellKey}`, () =>
        runRevisionedEdit(editToCommit.sheetId, (revision) =>
          getApiMethod('updateCellContent')(editToCommit.sheetId, editToCommit.cellKey, editToCommit.value, {
            revision,
          }),
        ),
      );
    }
    setEditingCell(null);
  }

  function startEditingCell(selection: ActiveCellSelection, initialValue?: string) {
    const sheet = workbook.sheets.find((candidate) => candidate.id === selection.sheetId);
    const value = initialValue ?? sheet?.cells[selection.cellKey]?.raw ?? '';

    setActiveCell(selection);
    setEditingCell({
      ...selection,
      value,
    });
  }

  function cancelActiveEdit() {
    if (editingCell) {
      setKeyboardFocusTarget({ sheetId: editingCell.sheetId, cellKey: editingCell.cellKey });
    }
    setEditingCell(null);
  }

  function selectCell(selection: ActiveCellSelection) {
    if (selection.sheetId !== activeCell?.sheetId || selection.cellKey !== activeCell.cellKey) {
      tabRunOriginColumn.current = null;
    }
    setKeyboardFocusTarget(null);
    setActiveCell(selection);
  }

  function navigateCell(sheet: Sheet, currentCellKey: string, direction: CellNavigationDirection) {
    const parsedAddress = parseA1Address(currentCellKey, sheet);
    if (!parsedAddress.ok) {
      return;
    }

    const directionDelta = {
      left: { columnIndex: -1, rowIndex: 0 },
      right: { columnIndex: 1, rowIndex: 0 },
      up: { columnIndex: 0, rowIndex: -1 },
      down: { columnIndex: 0, rowIndex: 1 },
    } satisfies Record<CellNavigationDirection, { columnIndex: number; rowIndex: number }>;
    const nextAddress = clampedCellAddress(sheet, parsedAddress.value, directionDelta[direction]);

    tabRunOriginColumn.current = null;
    const nextSelection = { sheetId: sheet.id, cellKey: cellKey(nextAddress) };
    setActiveCell(nextSelection);
    setKeyboardFocusTarget(nextSelection);
  }

  function commitEditAndNavigate(editToCommit: EditingCell, direction: 'tab' | 'enter') {
    const sheet = workbook.sheets.find((candidate) => candidate.id === editToCommit.sheetId);
    if (!sheet) {
      commitActiveEdit(editToCommit);
      return;
    }

    const parsedAddress = parseA1Address(editToCommit.cellKey, sheet);
    if (!parsedAddress.ok) {
      commitActiveEdit(editToCommit);
      return;
    }

    commitActiveEdit(editToCommit);

    if (direction === 'tab') {
      if (tabRunOriginColumn.current === null) {
        tabRunOriginColumn.current = parsedAddress.value.columnIndex;
      }

      const nextAddress = clampedCellAddress(sheet, parsedAddress.value, { columnIndex: 1, rowIndex: 0 });
      const nextSelection = { sheetId: sheet.id, cellKey: cellKey(nextAddress) };
      setActiveCell(nextSelection);
      setKeyboardFocusTarget(nextSelection);
      return;
    }

    const originColumn = tabRunOriginColumn.current ?? parsedAddress.value.columnIndex;
    const nextAddress = clampedCellAddress(
      sheet,
      {
        columnIndex: originColumn,
        rowIndex: parsedAddress.value.rowIndex,
      },
      { columnIndex: 0, rowIndex: 1 },
    );

    tabRunOriginColumn.current = null;
    const nextSelection = { sheetId: sheet.id, cellKey: cellKey(nextAddress) };
    setActiveCell(nextSelection);
    setKeyboardFocusTarget(nextSelection);
  }

  function updateEditingCellValue(value: string) {
    setEditingCell((currentEditingCell) =>
      currentEditingCell ? { ...currentEditingCell, value } : currentEditingCell,
    );
  }

  return {
    activeCell,
    cancelActiveEdit,
    commitActiveEdit,
    commitEditAndNavigate,
    editingCell,
    keyboardFocusTarget,
    navigateCell,
    selectCell,
    startEditingCell,
    updateEditingCellValue,
  };
}
