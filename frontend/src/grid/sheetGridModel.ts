import { matchesShortcut, type KeyboardInput, type Keymap, type Platform } from '@shared/keyboard/keymap';
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

  const request = gridNavigationRequest(event);
  if (request) return { kind: 'navigate', request };

  if (matchesShortcut(event, 'clear-cells')) {
    return { kind: 'clear-cell' };
  }

  if (key.length === 1 && !ctrlKey && !metaKey && !altKey) {
    return { kind: 'start-edit', initialValue: key };
  }

  return { kind: 'none' };
}

const navigationActions: readonly { id: string; request: CellNavigationRequest }[] = [
  { id: 'grid-left', request: { key: 'ArrowLeft', command: false, shift: false } },
  { id: 'grid-left-select', request: { key: 'ArrowLeft', command: false, shift: true } },
  { id: 'grid-left-jump', request: { key: 'ArrowLeft', command: true, shift: false } },
  { id: 'grid-left-jump-select', request: { key: 'ArrowLeft', command: true, shift: true } },
  { id: 'grid-right', request: { key: 'ArrowRight', command: false, shift: false } },
  { id: 'grid-right-select', request: { key: 'ArrowRight', command: false, shift: true } },
  { id: 'grid-right-jump', request: { key: 'ArrowRight', command: true, shift: false } },
  { id: 'grid-right-jump-select', request: { key: 'ArrowRight', command: true, shift: true } },
  { id: 'grid-up', request: { key: 'ArrowUp', command: false, shift: false } },
  { id: 'grid-up-select', request: { key: 'ArrowUp', command: false, shift: true } },
  { id: 'grid-up-jump', request: { key: 'ArrowUp', command: true, shift: false } },
  { id: 'grid-up-jump-select', request: { key: 'ArrowUp', command: true, shift: true } },
  { id: 'grid-down', request: { key: 'ArrowDown', command: false, shift: false } },
  { id: 'grid-down-select', request: { key: 'ArrowDown', command: false, shift: true } },
  { id: 'grid-down-jump', request: { key: 'ArrowDown', command: true, shift: false } },
  { id: 'grid-down-jump-select', request: { key: 'ArrowDown', command: true, shift: true } },
  { id: 'grid-home', request: { key: 'Home', command: false, shift: false } },
  { id: 'grid-home-select', request: { key: 'Home', command: false, shift: true } },
  { id: 'grid-home-jump', request: { key: 'Home', command: true, shift: false } },
  { id: 'grid-home-jump-select', request: { key: 'Home', command: true, shift: true } },
  { id: 'grid-end', request: { key: 'End', command: false, shift: false } },
  { id: 'grid-end-select', request: { key: 'End', command: false, shift: true } },
  { id: 'grid-end-jump', request: { key: 'End', command: true, shift: false } },
  { id: 'grid-end-jump-select', request: { key: 'End', command: true, shift: true } },
  { id: 'grid-next', request: { key: 'Tab', command: false, shift: false } },
  { id: 'grid-previous', request: { key: 'Tab', command: false, shift: true } },
  { id: 'grid-previous-row', request: { key: 'Enter', command: false, shift: true } },
];

export function gridNavigationRequest(event: KeyboardInput, platform?: Platform, map?: Keymap): CellNavigationRequest | undefined {
  return navigationActions.find(({ id }) => matchesShortcut(event, id, platform, map))?.request;
}
