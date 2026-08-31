import { describe, expect, it } from 'vitest';
import { tabularProjection } from './workbookQueries';
import { type FormulaEvaluationSnapshot } from './formulaValue';
import { getSheetCellDisplayText, gridCellKeyboardAction } from './sheetGridModel';
import { sheetDocument } from './test/workbookFactories';

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
    ).toEqual({ kind: 'navigate', direction: 'right' });
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
  });

  it('ignores inactive cells, nested editor events, and modified key commands', () => {
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
  });
});
