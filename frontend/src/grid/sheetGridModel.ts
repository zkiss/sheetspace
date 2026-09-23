import { cellRawContent } from '@workbook/read/queries';
import { displayFormulaValue, displayRawCellValue, type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { resolveNumberFormat } from '@workbook/core/numberFormat';
import { type SheetPresentation, type SheetTabularProjection } from '@workbook/core/model';
import type { CellNavigationDirection } from './cellInteractionContracts';

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
  presentation,
  sheet,
}: {
  cellKey: string;
  formulaResults: FormulaEvaluationSnapshot;
  presentation?: SheetPresentation;
  sheet: SheetTabularProjection;
}) {
  const identity = cellIdentityAt(sheet, cellKey);
  const format = identity ? resolveNumberFormat(presentation?.formatOverrides ?? { rows: {}, columns: {}, cells: {} }, identity) : undefined;
  const formulaResult = formulaResults[sheet.id]?.[cellKey];
  if (formulaResult) return displayFormulaValue(formulaResult, format).display;
  const raw = cellRawContent(sheet, cellKey);
  return raw === undefined ? '' : displayRawCellValue(raw, format).display;
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
