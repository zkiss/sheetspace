import { describe, expect, it } from 'vitest';
import { evaluateFormulaCells } from '@calculation/formulaEvaluator';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('formula operators and scalar values', () => {
  function sheetWithCells(id: string, name: string, cells: Record<string, string>) {
    return sheetDocument({ id, name, cells });
  }

  it('evaluates arithmetic precedence, grouping, associativity, unary chains, and references', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '8',
      A2: '2',
      B1: '=1+2*3',
      B2: '=(1+2)*3',
      B3: '=10-3-2',
      B4: '=--A1 + +A2',
      B5: '=-(A1+2)',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      A1: '=sheet-1!A1/sheet-1!A2',
    });
    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([inputs, outputs])));

    expect(results['sheet-1'].B1).toMatchObject({ kind: 'number', value: 7 });
    expect(results['sheet-1'].B2).toMatchObject({ kind: 'number', value: 9 });
    expect(results['sheet-1'].B3).toMatchObject({ kind: 'number', value: 5 });
    expect(results['sheet-1'].B4).toMatchObject({ kind: 'number', value: 10 });
    expect(results['sheet-1'].B5).toMatchObject({ kind: 'number', value: -10 });
    expect(results['sheet-2'].A1).toMatchObject({ kind: 'number', value: 4 });
  });

  it('returns typed arithmetic errors and isolates unrelated cells', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: 'text',
      A2: '',
      A3: 'TRUE',
      B1: '=1/0',
      B2: '=1/-0',
      B3: '=A1+1',
      B4: '=A2*2',
      B5: '=-A3',
      B6: '=1e308*2',
      B7: '=6/2',
    });
    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([inputs])))['sheet-1'];

    expect(results.B1).toMatchObject({ kind: 'error', error: '#DIV/0!' });
    expect(results.B2).toMatchObject({ kind: 'error', error: '#DIV/0!' });
    expect(results.B3).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.B4).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.B5).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.B6).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.B7).toMatchObject({ kind: 'number', value: 3 });
  });

  it('evaluates every comparison operator with equal and unequal numeric boundaries', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=2=2',
      A2: '=2<>3',
      A3: '=2<3',
      A4: '=2<=2',
      A5: '=3>2',
      A6: '=3>=3',
      A7: '=2>3',
    });
    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([inputs])))['sheet-1'];

    for (const key of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
      expect(results[key]).toEqual({ kind: 'boolean', value: true, display: 'TRUE' });
    }
    expect(results.A7).toEqual({ kind: 'boolean', value: false, display: 'FALSE' });
  });

  it('compares text by Unicode code point, booleans FALSE before TRUE, and blank with blank', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '="A"<"a"',
      A2: '="\u{10000}">"\u{E000}"',
      A3: '=FALSE<TRUE',
      A4: '=TRUE>=TRUE',
      A5: '=B1=B2',
      A6: '=B1<=B2',
      A7: '=B1<>B2',
    });
    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([inputs])))['sheet-1'];

    for (const key of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
      expect(results[key]).toMatchObject({ kind: 'boolean', value: true });
    }
    expect(results.A7).toMatchObject({ kind: 'boolean', value: false });
  });

  it('applies arithmetic before comparisons and compares same-sheet and cross-sheet references', () => {
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', {
      A1: '3',
      A2: '4',
      B1: '=A1*2>=A2+2',
    });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=B1<sheet-inputs!A2',
      A2: '=sheet-inputs!A1>B1',
      B1: '2',
    });
    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([inputs, outputs])));

    expect(results['sheet-inputs'].B1).toMatchObject({ kind: 'boolean', value: true });
    expect(results['sheet-outputs'].A1).toMatchObject({ kind: 'boolean', value: true });
    expect(results['sheet-outputs'].A2).toMatchObject({ kind: 'boolean', value: true });
  });

  it('returns #VALUE! for mixed categories and ranges, and propagates operand errors left to right', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=1="1"',
      A2: '=TRUE=1',
      A3: '=B1=B2',
      A4: '=B1:B2=B1:B2',
      A5: '=Missing!A1=(1/0)',
      A6: '=(1/0)=Missing!A1',
      B1: '',
      B2: 'text',
    });
    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([inputs])))['sheet-1'];

    for (const key of ['A1', 'A2', 'A3', 'A4']) {
      expect(results[key]).toMatchObject({ kind: 'error', error: '#VALUE!' });
    }
    expect(results.A5).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A6).toMatchObject({ kind: 'error', error: '#DIV/0!' });
  });

  it('propagates arithmetic operand errors from left to right', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=Missing!A1 + (1/0)',
      A2: '=(1/0) + Missing!A1',
    });
    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([inputs])))['sheet-1'];

    expect(results.A1).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A2).toMatchObject({ kind: 'error', error: '#DIV/0!' });
  });

  it('evaluates literal and grouped formulas as typed display results', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=12.5',
      A2: '="say ""hi"""',
      A3: '=TrUe',
      A4: '=((FALSE))',
      A5: '=""',
      A6: '=1e999',
    });
    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([inputs])))['sheet-1'];

    expect(results.A1).toEqual({ kind: 'number', value: 12.5, display: '12.5' });
    expect(results.A2).toEqual({ kind: 'text', value: 'say "hi"', display: 'say "hi"' });
    expect(results.A3).toEqual({ kind: 'boolean', value: true, display: 'TRUE' });
    expect(results.A4).toEqual({ kind: 'boolean', value: false, display: 'FALSE' });
    expect(results.A5).toEqual({ kind: 'text', value: '', display: '' });
    expect(results.A6).toEqual({ kind: 'error', error: '#VALUE!', display: '#VALUE!' });
  });

  it('preserves typed values through same-sheet and cross-sheet scalar references', () => {
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', {
      A1: ' 2.5 ',
      A2: 'TRUE',
      A3: ' source text ',
      A4: '   ',
      B1: '=A1',
      B2: '=A2',
      B3: '=A3',
      B4: '=A5',
    });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=sheet-inputs!B1',
      A2: '=sheet-inputs!B2',
      A3: '=sheet-inputs!B3',
      A4: '=sheet-inputs!B4',
      A5: '=sheet-inputs!A4',
    });
    const results = evaluateFormulaCells(calculationProjection(workbookWithSheets([inputs, outputs])));

    expect(results['sheet-inputs'].B1).toEqual({ kind: 'number', value: 2.5, display: '2.5' });
    expect(results['sheet-inputs'].B2).toEqual({ kind: 'boolean', value: true, display: 'TRUE' });
    expect(results['sheet-inputs'].B3).toEqual({
      kind: 'text',
      value: ' source text ',
      display: ' source text ',
    });
    expect(results['sheet-inputs'].B4).toEqual({ kind: 'blank', display: '' });
    expect(results['sheet-outputs'].A1).toEqual({ kind: 'number', value: 2.5, display: '2.5' });
    expect(results['sheet-outputs'].A2).toEqual({ kind: 'boolean', value: true, display: 'TRUE' });
    expect(results['sheet-outputs'].A3).toMatchObject({ kind: 'text', value: ' source text ' });
    expect(results['sheet-outputs'].A4).toEqual({ kind: 'blank', display: '' });
    expect(results['sheet-outputs'].A5).toEqual({ kind: 'text', value: '   ', display: '   ' });
  });
});
