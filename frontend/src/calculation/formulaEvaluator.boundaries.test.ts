import { describe, expect, it } from 'vitest';
import { evaluateFormulaCells } from '@calculation/formulaEvaluator';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('formula evaluator boundary outcomes', () => {
  it('reports parse, reference, type, division, and unknown-function failures independently', () => {
    const sheet = sheetDocument({
      id: 'inputs',
      name: 'Inputs',
      cells: {
        A1: '=Missing!A1',
        A2: '=Z999',
        A3: '=1/0',
        A4: '=1+"text"',
        A5: '=TRUE=1',
        A6: '=-"text"',
        A7: '=UNKNOWN(1)',
        A8: '=(',
      },
    });

    const values = evaluateFormulaCells(calculationProjection(workbookWithSheets([sheet])))['inputs'];

    expect(values).toMatchObject({
      A1: { kind: 'error', error: '#REF!' },
      A2: { kind: 'error', error: '#REF!' },
      A3: { kind: 'error', error: '#DIV/0!' },
      A4: { kind: 'error', error: '#VALUE!' },
      A5: { kind: 'error', error: '#VALUE!' },
      A6: { kind: 'error', error: '#VALUE!' },
      A7: { kind: 'error', error: '#NAME!' },
      A8: { kind: 'error', error: '#PARSE!' },
    });
  });

  it('evaluates unary, grouped, range, blank, and cross-sheet reference paths', () => {
    const inputs = sheetDocument({
      id: 'inputs',
      name: 'Inputs',
      cells: { A1: '2', A2: '', B1: '3' },
    });
    const outputs = sheetDocument({
      id: 'outputs',
      name: 'Outputs',
      cells: {
        A1: '=-(1 + 2)',
        A2: '=SUM(inputs!A1:B1)',
        A3: '=inputs!A2',
        A4: '=inputs!A1 * inputs!B1',
      },
    });

    const values = evaluateFormulaCells(
      calculationProjection(workbookWithSheets([inputs, outputs])),
    )['outputs'];

    expect(values).toMatchObject({
      A1: { kind: 'number', value: -3 },
      A2: { kind: 'number', value: 5 },
      A3: { kind: 'blank' },
      A4: { kind: 'number', value: 6 },
    });
  });
});
