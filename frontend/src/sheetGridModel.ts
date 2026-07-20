import type { FormulaEvaluationSnapshot, Sheet } from './workbook';
import type { CellNavigationDirection } from './appTypes';

export type ColumnHeader = {
  index: number;
  label: string;
};

export type GridCellKeyboardAction =
  | { kind: 'none' }
  | { kind: 'start-edit'; initialValue?: string }
  | { kind: 'clear-cell' }
  | { kind: 'navigate'; direction: CellNavigationDirection };

export function getSheetCellDisplayText({
  cellKey,
  formulaResults,
  sheet,
}: {
  cellKey: string;
  formulaResults: FormulaEvaluationSnapshot;
  sheet: Sheet;
}) {
  return formulaResults[sheet.id]?.[cellKey]?.display ?? sheet.cells[cellKey] ?? '';
}

export function gridCellKeyboardAction({
  altKey,
  ctrlKey,
  isActive,
  isCellTarget,
  key,
  metaKey,
}: {
  altKey: boolean;
  ctrlKey: boolean;
  isActive: boolean;
  isCellTarget: boolean;
  key: string;
  metaKey: boolean;
}): GridCellKeyboardAction {
  if (!isCellTarget || !isActive || altKey || ctrlKey || metaKey) {
    return { kind: 'none' };
  }

  if (key === 'Enter' || key === 'F2') {
    return { kind: 'start-edit' };
  }

  if (key === 'ArrowLeft') {
    return { kind: 'navigate', direction: 'left' };
  }

  if (key === 'ArrowRight') {
    return { kind: 'navigate', direction: 'right' };
  }

  if (key === 'ArrowUp') {
    return { kind: 'navigate', direction: 'up' };
  }

  if (key === 'ArrowDown') {
    return { kind: 'navigate', direction: 'down' };
  }

  if (key === 'Backspace' || key === 'Delete') {
    return { kind: 'clear-cell' };
  }

  if (key.length === 1) {
    return { kind: 'start-edit', initialValue: key };
  }

  return { kind: 'none' };
}
