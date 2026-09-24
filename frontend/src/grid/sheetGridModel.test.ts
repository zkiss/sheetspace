import { describe, expect, it } from 'vitest';
import { tabularProjection } from '@workbook/read/queries';
import { type FormulaEvaluationSnapshot } from '@calculation/formulaValue';
import { getSheetCellDisplayText, gridCellKeyboardAction } from './sheetGridModel';
import { sheetDocument } from '@test-support/workbookFactories';

function testSheet() {
  return tabularProjection(sheetDocument({
    id: 'sheet-inputs',
    name: 'Inputs',
    cells: {
      A1: 'Raw value',
      B1: '=SUM(A1)',
    },
  }));
}

describe('sheet grid model', () => {
  it('prefers evaluated formula display text over raw cell content', () => {
    const sheet = testSheet();
    const formulaResults: FormulaEvaluationSnapshot = {
      [sheet.id]: {
        B1: { kind: 'number', value: 12, display: '12' },
      },
    };

    expect(getSheetCellDisplayText({ cellKey: 'B1', formulaResults, sheet })).toBe('12');
    expect(getSheetCellDisplayText({ cellKey: 'A1', formulaResults, sheet })).toBe('Raw value');
    expect(getSheetCellDisplayText({ cellKey: 'C1', formulaResults, sheet })).toBe('');
  });

  it('formats numeric raw content and evaluated formula values from sparse presentation overrides', () => {
    const document = sheetDocument({
      id: 'formats',
      name: 'Formats',
      cells: { A1: '1.25', B1: '=A1' },
      presentation: {
        rowHeights: {}, columnWidths: {},
        formatOverrides: { rows: {}, columns: { 'formats:column:1': { numberFormat: { kind: 'percent', precision: 1 } } }, cells: {} },
      },
    });
    const sheet = tabularProjection(document);
    const formulaResults: FormulaEvaluationSnapshot = { [sheet.id]: { B1: { kind: 'number', value: 1.25, display: '1.25' } } };

    expect(getSheetCellDisplayText({ cellKey: 'A1', formulaResults, presentation: document.presentation, sheet })).toBe('125.0%');
    expect(getSheetCellDisplayText({ cellKey: 'B1', formulaResults, presentation: document.presentation, sheet })).toBe('1.25');
  });

  it('maps active cell keyboard input to spreadsheet intents', () => {
    expect(
      gridCellKeyboardAction({
        altKey: false,
        ctrlKey: false,
        isActive: true,
        isCellTarget: true,
        key: 'ArrowRight',
        metaKey: false,
      }),
    ).toEqual({ kind: 'navigate', request: { key: 'ArrowRight', command: false, shift: false } });
    expect(
      gridCellKeyboardAction({
        altKey: false,
        ctrlKey: false,
        isActive: true,
        isCellTarget: true,
        key: 'Delete',
        metaKey: false,
      }),
    ).toEqual({ kind: 'clear-cell' });
    expect(
      gridCellKeyboardAction({
        altKey: false,
        ctrlKey: false,
        isActive: true,
        isCellTarget: true,
        key: 'x',
        metaKey: false,
      }),
    ).toEqual({ kind: 'start-edit', initialValue: 'x' });

    const base = {
      altKey: false,
      ctrlKey: false,
      isActive: true,
      isCellTarget: true,
      metaKey: false,
    };
    expect(gridCellKeyboardAction({ ...base, key: 'Enter' })).toEqual({ kind: 'start-edit' });
    expect(gridCellKeyboardAction({ ...base, key: 'F2' })).toEqual({ kind: 'start-edit' });
    expect(gridCellKeyboardAction({ ...base, key: 'ArrowLeft' })).toEqual({ kind: 'navigate', request: { key: 'ArrowLeft', command: false, shift: false } });
    expect(gridCellKeyboardAction({ ...base, key: 'ArrowUp' })).toEqual({ kind: 'navigate', request: { key: 'ArrowUp', command: false, shift: false } });
    expect(gridCellKeyboardAction({ ...base, key: 'ArrowDown' })).toEqual({ kind: 'navigate', request: { key: 'ArrowDown', command: false, shift: false } });
    expect(gridCellKeyboardAction({ ...base, key: 'Backspace' })).toEqual({ kind: 'clear-cell' });
    expect(gridCellKeyboardAction({ ...base, key: 'Escape' })).toEqual({ kind: 'none' });
  });

  it('ignores inactive cells, nested editor events, and unrelated modified commands', () => {
    const inactive = {
      altKey: false,
      ctrlKey: false,
      isActive: false,
      isCellTarget: true,
      key: 'Enter',
      metaKey: false,
    };

    expect(gridCellKeyboardAction(inactive)).toEqual({ kind: 'none' });
    expect(gridCellKeyboardAction({ ...inactive, isActive: true, isCellTarget: false })).toEqual({ kind: 'none' });
    expect(gridCellKeyboardAction({ ...inactive, isActive: true, ctrlKey: true })).toEqual({ kind: 'none' });
    expect(gridCellKeyboardAction({ ...inactive, isActive: true, altKey: true })).toEqual({ kind: 'none' });
    expect(gridCellKeyboardAction({ ...inactive, isActive: true, metaKey: true })).toEqual({ kind: 'none' });
  });

  it('routes keyboard navigation modifiers through the navigation model', () => {
    const base = { altKey: false, ctrlKey: false, isActive: true, isCellTarget: true, metaKey: false };
    expect(gridCellKeyboardAction({ ...base, key: 'Home', shiftKey: true })).toEqual(
      { kind: 'navigate', request: { key: 'Home', command: false, shift: true } },
    );
    expect(gridCellKeyboardAction({ ...base, key: 'ArrowDown', ctrlKey: true })).toEqual(
      { kind: 'navigate', request: { key: 'ArrowDown', command: true, shift: false } },
    );
    expect(gridCellKeyboardAction({ ...base, key: 'Tab', shiftKey: true })).toEqual(
      { kind: 'navigate', request: { key: 'Tab', command: false, shift: true } },
    );
    expect(gridCellKeyboardAction({ ...base, key: 'Enter', shiftKey: true })).toEqual(
      { kind: 'navigate', request: { key: 'Enter', command: false, shift: true } },
    );
  });
});
