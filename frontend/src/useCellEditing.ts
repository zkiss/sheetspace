import { useEffect, useRef, useState } from 'react';
import {
  cellKey,
  cellRawContent,
  findSheetById,
  formulaRawForDisplay,
  parseA1Address,
  sheetBounds,
  sheetsInOrder,
  type CellAddress,
  type SheetDocument,
  type SheetTabularProjection,
  type Workbook,
} from './workbook';
import type { ActiveCellSelection, CellNavigationDirection, EditingCell } from './appTypes';
import type { WorkbookCommands } from './useWorkbookController';

const EMPTY_SHEET_ID_REMAPS: Readonly<Record<string, string>> = {};

function remapSelectionSheetId<T extends ActiveCellSelection>(
  selection: T | null,
  sheetIdRemaps: Readonly<Record<string, string>>,
): T | null {
  const remappedSheetId = selection && sheetIdRemaps[selection.sheetId];
  return selection && remappedSheetId && remappedSheetId !== selection.sheetId
    ? { ...selection, sheetId: remappedSheetId }
    : selection;
}

function clampedCellAddress(
  sheet: SheetDocument | SheetTabularProjection,
  address: CellAddress,
  delta: { columnIndex: number; rowIndex: number },
): CellAddress {
  return {
    columnIndex: Math.min(sheetBounds(sheet).columnCount - 1, Math.max(0, address.columnIndex + delta.columnIndex)),
    rowIndex: Math.min(sheetBounds(sheet).rowCount - 1, Math.max(0, address.rowIndex + delta.rowIndex)),
  };
}

export function useCellEditing({
  commands,
  sheetIdRemaps = EMPTY_SHEET_ID_REMAPS,
  workbook,
}: {
  commands: Pick<WorkbookCommands, 'updateCellContent'>;
  sheetIdRemaps?: Readonly<Record<string, string>>;
  workbook: Workbook;
}) {
  const [activeCell, setActiveCell] = useState<ActiveCellSelection | null>(null);
  const [keyboardFocusTarget, setKeyboardFocusTarget] = useState<ActiveCellSelection | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const tabRunOriginColumn = useRef<number | null>(null);

  useEffect(() => {
    setActiveCell((currentActiveCell) => remapSelectionSheetId(currentActiveCell, sheetIdRemaps));
    setKeyboardFocusTarget((currentFocusTarget) =>
      remapSelectionSheetId(currentFocusTarget, sheetIdRemaps),
    );
    setEditingCell((currentEditingCell) => remapSelectionSheetId(currentEditingCell, sheetIdRemaps));
  }, [sheetIdRemaps]);

  useEffect(() => {
    const sheetIds = new Set(sheetsInOrder(workbook).map((sheet) => sheet.id));
    setActiveCell((currentActiveCell) =>
      currentActiveCell && !sheetIds.has(currentActiveCell.sheetId) ? null : currentActiveCell,
    );
    setKeyboardFocusTarget((currentFocusTarget) =>
      currentFocusTarget && !sheetIds.has(currentFocusTarget.sheetId) ? null : currentFocusTarget,
    );
    setEditingCell((currentEditingCell) =>
      currentEditingCell && !sheetIds.has(currentEditingCell.sheetId) ? null : currentEditingCell,
    );
  }, [workbook.manifest.sheetIds]);

  function commitActiveEdit(editToCommit = editingCell) {
    if (!editToCommit) {
      return;
    }

    const currentSheet = findSheetById(workbook, editToCommit.sheetId);
    if (!currentSheet) {
      setEditingCell(null);
      return;
    }

    const currentCell = cellRawContent(currentSheet, editToCommit.cellKey);
    const currentRaw = currentCell ?? '';
    const currentEditValue = currentCell ? formulaRawForDisplay(currentCell, workbook) : currentRaw;
    if (
      currentEditValue !== editToCommit.value ||
      (currentCell && currentRaw.length === 0 && editToCommit.value.length === 0)
    ) {
      commands.updateCellContent(editToCommit.sheetId, editToCommit.cellKey, editToCommit.value);
    }
    setEditingCell(null);
  }

  function startEditingCell(selection: ActiveCellSelection, initialValue?: string) {
    const sheet = findSheetById(workbook, selection.sheetId);
    const cell = sheet && cellRawContent(sheet, selection.cellKey);
    const value = initialValue ?? (cell ? formulaRawForDisplay(cell, workbook) : '');

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

  function clearCellContent(selection: ActiveCellSelection) {
    setActiveCell(selection);
    setKeyboardFocusTarget(selection);
    setEditingCell(null);

    const sheet = findSheetById(workbook, selection.sheetId);
    if (!sheet || !cellRawContent(sheet, selection.cellKey)) {
      return;
    }

    commands.updateCellContent(selection.sheetId, selection.cellKey, '');
  }

  function selectCell(selection: ActiveCellSelection) {
    if (selection.sheetId !== activeCell?.sheetId || selection.cellKey !== activeCell.cellKey) {
      tabRunOriginColumn.current = null;
    }
    setKeyboardFocusTarget(null);
    setActiveCell(selection);
  }

  function selectReferenceTarget(selection: ActiveCellSelection) {
    tabRunOriginColumn.current = null;
    setEditingCell(null);
    setActiveCell(selection);
    setKeyboardFocusTarget(selection);
  }

  function navigateCell(sheet: SheetTabularProjection, currentCellKey: string, direction: CellNavigationDirection) {
    const parsedAddress = parseA1Address(currentCellKey, sheetBounds(sheet));
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
    const sheet = findSheetById(workbook, editToCommit.sheetId);
    if (!sheet) {
      commitActiveEdit(editToCommit);
      return;
    }

    const parsedAddress = parseA1Address(editToCommit.cellKey, sheetBounds(sheet));
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
    clearCellContent,
    commitActiveEdit,
    commitEditAndNavigate,
    editingCell,
    keyboardFocusTarget,
    navigateCell,
    selectCell,
    selectReferenceTarget,
    startEditingCell,
    updateEditingCellValue,
  };
}
