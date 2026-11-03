import { matchesShortcut, detectPlatform } from '@shared/keyboard/keymap';
import { cellRawContent } from '@workbook/read/queries';
import { displayFormulaValue, displayRawCellValue, type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { cellIdentityAt } from '@workbook/core/cellIdentity';
import { resolveNumberFormat } from '@workbook/core/numberFormat';
import { type SheetPresentation, type SheetTabularProjection } from '@workbook/core/model';
import type { CellNavigationRequest } from './cellInteractionContracts';

export type ColumnHeader = {
  index: number;
  label: string;
};

export type GridCellKeyboardAction =
  | { kind: 'none' }
  | { kind: 'start-edit'; initialValue?: string }
  | { kind: 'clear-cell' }
  | { kind: 'navigate'; request: CellNavigationRequest };

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
  code = '',
  isActive,
  isCellTarget,
  key,
  metaKey,
  shiftKey = false,
}: {
  altKey: boolean;
  ctrlKey: boolean;
  code?: string;
  isActive: boolean;
  isCellTarget: boolean;
  key: string;
  metaKey: boolean;
  shiftKey?: boolean;
}): GridCellKeyboardAction {
  const event = { key, code, altKey, ctrlKey, metaKey, shiftKey };
  if (!isCellTarget || !isActive) {
    return { kind: 'none' };
  }

  if (matchesShortcut(event, 'edit-cell')) {
    return { kind: 'start-edit' };
  }

  const isDirectionalNavigationKey = key === 'ArrowLeft' || key === 'ArrowRight'
    || key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End';
  const isUnmodifiedTraversalKey = !ctrlKey && !metaKey
    && (key === 'Tab' || (key === 'Enter' && shiftKey));
  if (!altKey && (isDirectionalNavigationKey || isUnmodifiedTraversalKey)) {
    return {
      kind: 'navigate',
      request: { key, command: detectPlatform() === 'mac' ? metaKey && !ctrlKey : ctrlKey && !metaKey, shift: shiftKey },
    };
  }

  if (matchesShortcut(event, 'clear-cells')) {
    return { kind: 'clear-cell' };
  }

  if (key.length === 1 && !ctrlKey && !metaKey && !altKey) {
    return { kind: 'start-edit', initialValue: key };
  }

  return { kind: 'none' };
}
