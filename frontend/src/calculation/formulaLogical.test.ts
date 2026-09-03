import { describe, expect, it } from 'vitest';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { evaluateFormulaCells } from '@calculation/formulaEvaluator';
import { sheetDocument, workbookWithSheets } from '@test/workbookFactories';

describe('logical formula functions', () => {
  it('evaluates IF truth cases, nested logic, and preserves selected value types', () => {
    const results = evaluate({
      A1: '=IF(TRUE, 7, 8)',
      A2: '=IF(FALSE, "yes", "no")',
      A3: '=IF(AND(TRUE, NOT(FALSE)), FALSE, 3)',
      A4: '=IF(FALSE, 1, A8)',
      A8: '',
    });

    expect(results.A1).toMatchObject({ kind: 'number', value: 7 });
    expect(results.A2).toMatchObject({ kind: 'text', value: 'no' });
    expect(results.A3).toMatchObject({ kind: 'boolean', value: false });
    expect(results.A4).toMatchObject({ kind: 'blank' });
  });

  it('evaluates only the selected IF branch', () => {
    const results = evaluate({
      A1: '=IF(FALSE, 1/0, 2)',
      A2: '=IF(TRUE, 3, UNKNOWN())',
      A3: '=IF(FALSE, ABS(1, 2), 4)',
      A4: '=IF(TRUE, 5, A5:A6)',
    });

    expect(results.A1).toMatchObject({ kind: 'number', value: 2 });
    expect(results.A2).toMatchObject({ kind: 'number', value: 3 });
    expect(results.A3).toMatchObject({ kind: 'number', value: 4 });
    expect(results.A4).toMatchObject({ kind: 'number', value: 5 });
  });

  it('applies AND, OR, and NOT truth tables', () => {
    const results = evaluate({
      A1: '=AND(TRUE, TRUE)',
      A2: '=AND(TRUE, FALSE)',
      A3: '=OR(FALSE, FALSE)',
      A4: '=OR(FALSE, TRUE)',
      A5: '=NOT(TRUE)',
      A6: '=NOT(FALSE)',
    });

    expect(results.A1).toMatchObject({ kind: 'boolean', value: true });
    expect(results.A2).toMatchObject({ kind: 'boolean', value: false });
    expect(results.A3).toMatchObject({ kind: 'boolean', value: false });
    expect(results.A4).toMatchObject({ kind: 'boolean', value: true });
    expect(results.A5).toMatchObject({ kind: 'boolean', value: false });
    expect(results.A6).toMatchObject({ kind: 'boolean', value: true });
  });

  it('ignores blanks, rejects other scalar types, and requires a boolean value', () => {
    const results = evaluate({
      A1: '', A2: 'TRUE', A3: '',
      B1: '=AND(A1:A3)',
      B2: '=OR(A1, A3)',
      B3: '=AND(TRUE, 1)',
      B4: '=OR(FALSE, "TRUE")',
      B5: '=NOT(A1)',
      B6: '=IF(1, 2, 3)',
    });

    expect(results.B1).toMatchObject({ kind: 'boolean', value: true });
    for (const key of ['B2', 'B3', 'B4', 'B5', 'B6']) {
      expect(results[key]).toMatchObject({ kind: 'error', error: '#VALUE!' });
    }
  });

  it('short-circuits decisive logical results and propagates visited errors', () => {
    const results = evaluate({
      A1: 'FALSE', A2: '=1/0',
      B1: '=AND(A1:A2)',
      B2: '=AND(TRUE, A2)',
      C1: 'TRUE', C2: '=UNKNOWN()',
      D1: '=OR(C1:C2)',
      D2: '=OR(FALSE, C2)',
    });

    expect(results.B1).toMatchObject({ kind: 'boolean', value: false });
    expect(results.B2).toMatchObject({ kind: 'error', error: '#DIV/0!' });
    expect(results.D1).toMatchObject({ kind: 'boolean', value: true });
    expect(results.D2).toMatchObject({ kind: 'error', error: '#NAME!' });
  });

  it('returns value errors for wrong argument counts and selected ranges', () => {
    const results = evaluate({
      A1: '=IF(TRUE, 1)',
      A2: '=AND()',
      A3: '=OR()',
      A4: '=NOT()',
      A5: '=NOT(TRUE, FALSE)',
      A6: '=IF(TRUE, B1:B2, 1)',
    });

    for (const key of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
      expect(results[key]).toMatchObject({ kind: 'error', error: '#VALUE!' });
    }
  });
});

function evaluate(cells: Record<string, string>) {
  const sheet = sheetDocument({ id: 'sheet-1', name: 'Inputs', cells });
  return evaluateFormulaCells(calculationProjection(workbookWithSheets([sheet])))['sheet-1'];
}
