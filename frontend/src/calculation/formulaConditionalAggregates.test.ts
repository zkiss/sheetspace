import { describe, expect, it } from 'vitest';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { evaluateFormulaCells } from '@calculation/formulaEvaluator';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('conditional aggregate formula functions', () => {
  it('counts equality and ordered matches across cells and 2D ranges', () => {
    const sheet = sheetDocument({
      id: 'sheet-1',
      name: 'Inputs',
      cells: {
        A1: '9', B1: '10',
        A2: '="10"', B2: '11',
        D1: '=COUNTIF(A1:B2, ">=10")',
        D2: '=COUNTIF(A1:B2, 9)',
        D3: '=COUNTIF(B2, ">10")',
        D4: '=COUNTIF(A1:B2, "missing")',
        D5: '=COUNTIF(B1:B2, ">=10")',
      },
    });

    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([sheet])))['sheet-1'];

    expect(results.D1).toMatchObject({ kind: 'number', value: 2 });
    expect(results.D2).toMatchObject({ kind: 'number', value: 1 });
    expect(results.D3).toMatchObject({ kind: 'number', value: 1 });
    expect(results.D4).toMatchObject({ kind: 'number', value: 0 });
    expect(results.D5).toMatchObject({ kind: 'number', value: 2 });
  });

  it('matches blank, text, and boolean criteria without cross-category coercion', () => {
    const sheet = sheetDocument({
      id: 'sheet-1',
      name: 'Inputs',
      cells: {
        A1: '', A2: '=""', A3: 'FALSE', A4: 'TRUE', A5: '10', A6: '="10"',
        B1: '=COUNTIF(A1:A6, "=")',
        B2: '=COUNTIF(A1:A6, "<>")',
        B3: '=COUNTIF(A1:A6, TRUE)',
        B4: '=COUNTIF(A1:A6, "=""10""")',
        B5: '=COUNTIF(A1:A6, "=10")',
        B6: '=COUNTIF(A1:A6, A1)',
      },
    });

    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([sheet])))['sheet-1'];

    expect(results.B1).toMatchObject({ kind: 'number', value: 1 });
    expect(results.B2).toMatchObject({ kind: 'number', value: 5 });
    expect(results.B3).toMatchObject({ kind: 'number', value: 1 });
    expect(results.B4).toMatchObject({ kind: 'number', value: 1 });
    expect(results.B5).toMatchObject({ kind: 'number', value: 1 });
    expect(results.B6).toMatchObject({ kind: 'number', value: 1 });
  });

  it('sums aligned numeric values in two- and three-argument forms', () => {
    const sheet = sheetDocument({
      id: 'sheet-1',
      name: 'Inputs',
      cells: {
        A1: '1', B1: '-1', A2: '2', B2: 'open',
        A3: 'match', B3: '', A4: 'match', B4: 'text', A5: 'match', B5: 'TRUE',
        C1: '10', D1: '20', C2: '30', D2: '40',
        F1: '=SUMIF(A1:B2, ">0", C1:D2)',
        F2: '=SUMIF(A1:B2, ">0")',
        F3: '=SUMIF(A1:B2, "missing", C1:D2)',
        F4: '=SUMIF(B2, "open", D2)',
        F5: '=SUMIF(A3:A5, "match", B3:B5)',
      },
    });

    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([sheet])))['sheet-1'];

    expect(results.F1).toMatchObject({ kind: 'number', value: 40 });
    expect(results.F2).toMatchObject({ kind: 'number', value: 3 });
    expect(results.F3).toMatchObject({ kind: 'number', value: 0 });
    expect(results.F4).toMatchObject({ kind: 'number', value: 40 });
    expect(results.F5).toMatchObject({ kind: 'number', value: 0 });
  });

  it('validates arity, reference positions, criteria, and shapes before value evaluation', () => {
    const sheet = sheetDocument({
      id: 'sheet-1',
      name: 'Inputs',
      cells: {
        A1: '1', A2: '2',
        B1: '=COUNTIF(A1:A2)',
        B2: '=COUNTIF(1, 1)',
        B3: '=COUNTIF(A1:A2, A1:A2)',
        B4: '=COUNTIF(A1:A2, ">")',
        B5: '=SUMIF(A1:A2, 1, A1)',
        B6: '=SUMIF(A1:A2, 1, Missing!A1)',
        B7: '=SUMIF(A1:A2, 1, Missing!A1:A2)',
        B8: '=COUNTIF(A1:A2, Missing!A1)',
      },
    });

    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([sheet])))['sheet-1'];

    for (const key of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) {
      expect(results[key]).toMatchObject({ kind: 'error', error: '#VALUE!' });
    }
    expect(results.B7).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.B8).toMatchObject({ kind: 'error', error: '#REF!' });
  });

  it('propagates criteria errors and only propagates sum errors at matching positions', () => {
    const sheet = sheetDocument({
      id: 'sheet-1',
      name: 'Inputs',
      cells: {
        A1: '0', A2: '1', A3: '=1/0',
        B1: '=1/0', B2: '=Missing!A1', B3: '10',
        C1: '=SUMIF(A1, ">0", B1)',
        C2: '=SUMIF(A1:A2, ">0", B1:B2)',
        C3: '=COUNTIF(A1:A3, ">0")',
      },
    });

    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([sheet])))['sheet-1'];

    expect(results.C1).toMatchObject({ kind: 'number', value: 0 });
    expect(results.C2).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.C3).toMatchObject({ kind: 'error', error: '#DIV/0!' });
  });

  it('evaluates cross-sheet criteria and sum ranges', () => {
    const inputs = sheetDocument({
      id: 'sheet-inputs', name: 'Inputs',
      cells: { A1: 'east', A2: 'west', A3: 'east', B1: '2', B2: '5', B3: '7' },
    });
    const outputs = sheetDocument({
      id: 'sheet-outputs', name: 'Outputs',
      cells: {
        A1: '=COUNTIF(sheet-inputs!A1:A3, "east")',
        A2: '=SUMIF(sheet-inputs!A1:A3, "east", sheet-inputs!B1:B3)',
      },
    });

    const results = evaluateFormulaCells(
      calculationProjection(workbookWithSheets([inputs, outputs])),
    )['sheet-outputs'];

    expect(results.A1).toMatchObject({ kind: 'number', value: 2 });
    expect(results.A2).toMatchObject({ kind: 'number', value: 9 });
  });
});
