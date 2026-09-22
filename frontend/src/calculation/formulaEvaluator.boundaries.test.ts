import { describe, expect, it } from 'vitest';
import { evaluateFormulaCells, FormulaEvaluator } from '@calculation/formulaEvaluator';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { cellIdentityAt, cellIdentityKey } from '@workbook/core/cellIdentity';
import { sheetCellNodeId } from '@calculation/nodeIdentity';
import type { CalculationProjection } from '@workbook/read/calculationProjection';

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

  it('memoizes supplied results, reports canonical coordinates, and marks cyclic references', () => {
    const sheet = sheetDocument({
      id: 'inputs', name: 'Inputs',
      cells: { A1: '=A2', A2: '=A1', B1: '=1+1', C1: 'plain' },
    });
    const projection = calculationProjection(workbookWithSheets([sheet]));
    const observed: string[] = [];
    const a1 = cellIdentityAt(sheet.content, 'A1')!;
    const evaluator = new FormulaEvaluator(
      projection,
      new Map([[sheetCellNodeId('inputs', cellIdentityKey(a1)), { kind: 'number' as const, value: 99 }]]),
      (sheetId, key) => observed.push(`${sheetId}:${key}`),
    );

    const values = evaluator.evaluate().inputs;
    expect(values).toMatchObject({
      A1: { kind: 'number', value: 99 },
      A2: { kind: 'number', value: 99 },
      B1: { kind: 'number', value: 2 },
    });
    expect(observed).toEqual(['inputs:B1', 'inputs:A2']);
    expect(evaluator.formulaResults()).not.toBe(evaluator.formulaResults());

    const cyclic = evaluateFormulaCells(calculationProjection(workbookWithSheets([
      sheetDocument({ id: 'cycle', name: 'Cycle', cells: { A1: '=A2', A2: '=A1' } }),
    ]))).cycle;
    expect(cyclic).toMatchObject({
      A1: { kind: 'error', error: '#CYCLE!' },
      A2: { kind: 'error', error: '#CYCLE!' },
    });
  });

  it('propagates nested operand errors and validates canonical and grouped reference boundaries', () => {
    const sheet = sheetDocument({
      id: 'inputs',
      name: 'Inputs',
      cells: {
        A1: '2', A2: '3',
        B1: '=-(1/0)',
        B2: '=1+(1/0)',
        B3: '=Z999:Z1000',
        B4: '=@[inputs:column:1,inputs:row:1]',
        B5: '=@[missing-column,missing-row]',
        B6: '=COUNTIF((@[inputs:column:1,inputs:row:1]:@[inputs:column:1,inputs:row:2]), ">0")',
        B7: '=COUNTIF(@[inputs:column:1,inputs:row:1]:@[missing-column,missing-row], ">0")',
      },
    });

    const values = evaluateFormulaCells(calculationProjection(workbookWithSheets([sheet]))).inputs;

    expect(values).toMatchObject({
      B1: { kind: 'error', error: '#DIV/0!' },
      B2: { kind: 'error', error: '#DIV/0!' },
      B3: { kind: 'error', error: '#REF!' },
      B4: { kind: 'number', value: 2 },
      B5: { kind: 'error', error: '#REF!' },
      B6: { kind: 'number', value: 2 },
      B7: { kind: 'error', error: '#REF!' },
    });
  });

  it('keeps malformed durable keys out of snapshots while reporting their raw observer keys', () => {
    const malformed: CalculationProjection = {
      sheets: [{
        id: 'malformed',
        rows: ['row-1'],
        columns: ['column-1'],
        cells: {
          malformed: '=1',
          ['missing-row\0column-1']: '=2',
          ['row-1\0missing-column']: '=3',
        },
      }],
    };
    const observed: string[] = [];

    const values = new FormulaEvaluator(
      malformed,
      new Map(),
      (_sheetId, key) => observed.push(key),
    ).evaluate();

    expect(values).toEqual({ malformed: {} });
    expect(observed).toEqual(['malformed', 'missing-row\0column-1', 'row-1\0missing-column']);
  });
});
