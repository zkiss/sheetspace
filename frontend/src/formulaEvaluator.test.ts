import { describe, expect, it } from 'vitest';
import { FormulaEvaluator } from './formulaEvaluator';
import type { FormulaFunctionRegistry, LazyFormulaFunction } from './formulaFunctions';
import { formulaScalarValue } from './formulaValue';
import {
  createSheet,
  evaluateFormulaCells,
  type Sheet,
} from './workbook';

function sheet(id: string, name: string): Sheet {
  const result = createSheet({ id, name });
  if (!result.ok) {
    throw new Error(`Failed to create test sheet ${name}`);
  }
  return result.value;
}

describe('formula evaluator', () => {
  function sheetWithCells(id: string, name: string, cells: Sheet['cells']): Sheet {
    return {
      ...sheet(id, name),
      cells,
    };
  }

  it('evaluates same-sheet SUM references, ranges, variable arguments, and empty cells', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '1',
      A2: '2',
      B1: '  -3.5  ',
      B2: '=SUM(A1:A2, B1, C1)',
      B3: '=SUM()',
    });
    const workbook = { version: 1 as const, sheets: [inputs] };

    expect(evaluateFormulaCells(workbook)['sheet-1'].B2).toEqual({
      kind: 'number',
      value: -0.5,
      display: '-0.5',
    });
    expect(evaluateFormulaCells(workbook)['sheet-1'].B3).toEqual({
      kind: 'number',
      value: 0,
      display: '0',
    });
  });

  it('evaluates cross-sheet cell and range references by canonical sheet id', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '4',
      A2: '5',
      B1: '6',
      B2: '7',
    });
    const sales = sheetWithCells('sheet-2', 'Sales Q1', {
      A1: '3',
    });
    const outputs = sheetWithCells('sheet-3', 'Outputs', {
      A1: '=SUM(sheet-1!A1:B2, sheet-2!A1)',
    });
    const workbook = { version: 1 as const, sheets: [inputs, sales, outputs] };

    expect(evaluateFormulaCells(workbook)['sheet-3'].A1).toMatchObject({
      kind: 'number',
      value: 25,
      display: '25',
    });
  });

  it('evaluates common numeric and aggregate functions over scalars, references, and ranges', () => {
    const inputs = sheetWithCells('sheet-inputs', 'Inputs', {
      A1: '2',
      A2: '4',
      A3: 'text',
      A4: 'TRUE',
      A5: '',
      A6: '   ',
      B1: '=AVERAGE(A1:A6, 10)',
      B2: '=MIN(A1:A6, -1)',
      B3: '=MAX(A1:A6, 10)',
      B4: '=COUNT(A1:A6, "9", FALSE, 3)',
      B5: '=COUNTA(A1:A6, "", FALSE)',
      B6: '=ABS(-3.5)',
      B7: '=SQRT(ABS(-16))',
      C1: '-11',
      C2: '25',
    });
    const outputs = sheetWithCells('sheet-outputs', 'Outputs', {
      A1: '=AVERAGE(sheet-inputs!A1:A2)',
      A2: '=COUNT(sheet-inputs!A1:A6)',
      A3: '=COUNTA(sheet-inputs!A1:A6)',
      A4: '=MIN(sheet-inputs!A1:A6)',
      A5: '=MAX(sheet-inputs!A1:A6)',
      A6: '=ABS(sheet-inputs!C1)',
      A7: '=SQRT(sheet-inputs!C2)',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs, outputs] });

    expect(results['sheet-inputs'].B1).toMatchObject({ kind: 'number', value: 16 / 3 });
    expect(results['sheet-inputs'].B2).toMatchObject({ kind: 'number', value: -1 });
    expect(results['sheet-inputs'].B3).toMatchObject({ kind: 'number', value: 10 });
    expect(results['sheet-inputs'].B4).toMatchObject({ kind: 'number', value: 3 });
    expect(results['sheet-inputs'].B5).toMatchObject({ kind: 'number', value: 7 });
    expect(results['sheet-inputs'].B6).toMatchObject({ kind: 'number', value: 3.5 });
    expect(results['sheet-inputs'].B7).toMatchObject({ kind: 'number', value: 4 });
    expect(results['sheet-outputs'].A1).toMatchObject({ kind: 'number', value: 3 });
    expect(results['sheet-outputs'].A2).toMatchObject({ kind: 'number', value: 2 });
    expect(results['sheet-outputs'].A3).toMatchObject({ kind: 'number', value: 5 });
    expect(results['sheet-outputs'].A4).toMatchObject({ kind: 'number', value: 2 });
    expect(results['sheet-outputs'].A5).toMatchObject({ kind: 'number', value: 4 });
    expect(results['sheet-outputs'].A6).toMatchObject({ kind: 'number', value: 11 });
    expect(results['sheet-outputs'].A7).toMatchObject({ kind: 'number', value: 5 });
  });

  it('applies aggregate empty, arity, type, domain, and error rules consistently', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=AVERAGE(B1:B3)',
      A2: '=MIN(B1:B3)',
      A3: '=MAX(B1:B3)',
      A4: '=COUNT()',
      A5: '=COUNTA()',
      A6: '=ABS()',
      A7: '=ABS(1, 2)',
      A8: '=ABS(B1:B2)',
      A9: '=SQRT(-1)',
      A10: '=SQRT("4")',
      A11: '=AVERAGE(C1:C2)',
      A12: '=COUNT(B1:B3)',
      B1: 'text',
      B2: 'TRUE',
      B3: '',
      C1: '=SUM(Missing!A1)',
      C2: '1',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.A1).toMatchObject({ kind: 'error', error: '#DIV/0!' });
    expect(results.A2).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A3).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A4).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A5).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A6).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A7).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A8).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A9).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A10).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A11).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A12).toMatchObject({ kind: 'number', value: 0 });
  });

  it('validates visited function calls before evaluating their arguments', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=ABS(1/0, Missing!A1)',
      A2: '=ABS(Missing!A1:A2)',
      A3: '=NOPE(1/0)',
      A4: '=SUM(1/0, Missing!A1)',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.A1).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A2).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(results.A3).toMatchObject({ kind: 'error', error: '#NAME!' });
    expect(results.A4).toMatchObject({ kind: 'error', error: '#DIV/0!' });
  });

  it('supports a lazy function without evaluating its unselected expression', () => {
    const first: LazyFormulaFunction = {
      evaluation: 'lazy',
      arity: { min: 2, max: 2 },
      argumentKind: () => 'scalar',
      invoke: (arguments_, context) => formulaScalarValue(
        context.evaluateArgument(arguments_[0], 'scalar'),
      ),
    };
    const functions: FormulaFunctionRegistry = new Map([['FIRST', first]]);
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=FIRST(42, 1/0)',
    });

    expect(new FormulaEvaluator(
      { version: 1 as const, sheets: [inputs] },
      new Map(),
      undefined,
      functions,
    ).evaluate()['sheet-1'].A1).toEqual({ kind: 'number', value: 42, display: '42' });
  });

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
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs, outputs] });

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
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

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
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

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
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

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
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs, outputs] });

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
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

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
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.A1).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A2).toMatchObject({ kind: 'error', error: '#DIV/0!' });
  });

  it('evaluates persisted sheet references by uuid after the target is renamed', () => {
    const inputs = sheetWithCells('sheet-1', 'Renamed Inputs', {
      A1: '7',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      A1: '=SUM(sheet-1!A1)',
    });
    const workbook = { version: 1 as const, sheets: [inputs, outputs] };

    expect(evaluateFormulaCells(workbook)['sheet-2'].A1).toMatchObject({
      kind: 'number',
      value: 7,
      display: '7',
    });
  });

  it('does not rebind persisted references when a deleted target placeholder name is reused', () => {
    const replacementInputs = sheetWithCells('sheet-replacement', '__sheetspace_missing_sheet_deleted', {
      A1: '99',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      A1: '=SUM(sheet-deleted!A1)',
    });
    const workbook = { version: 1 as const, sheets: [replacementInputs, outputs] };

    expect(evaluateFormulaCells(workbook)['sheet-2'].A1).toMatchObject({
      kind: 'error',
      error: '#REF!',
      display: '#REF!',
    });
  });

  it('classifies referenced cells using shared Phase 2 scalar semantics', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '  10 ',
      A2: '-2.25',
      A3: '=SUM(A1:A2)',
      B1: '=SUM(C1)',
      B2: '=SUM(C2)',
      B3: '=SUM(C3)',
      C1: '+1',
      C2: '1.',
      C3: '1e2',
    });
    const workbook = { version: 1 as const, sheets: [inputs] };

    const results = evaluateFormulaCells(workbook)['sheet-1'];
    expect(results.A3).toMatchObject({ kind: 'number', value: 7.75, display: '7.75' });
    expect(results.B1).toMatchObject({ kind: 'number', value: 0, display: '0' });
    expect(results.B2).toMatchObject({ kind: 'number', value: 1, display: '1' });
    expect(results.B3).toMatchObject({ kind: 'number', value: 100, display: '100' });
  });

  it('keeps parse, name, ref, and value failures isolated to cell-level results', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(A1,)',
      A2: '=NOPE(B1)',
      A3: '=SUM(Missing!A1)',
      A4: '=SUM(B1)',
      A5: '=SUM(C1)',
      A6: '=SUM(K1)',
      A7: '=SUM(A1:K1)',
      A8: '=SUM(A1:)',
      B1: 'text',
      C1: '8',
    });
    const workbook = { version: 1 as const, sheets: [inputs] };

    const results = evaluateFormulaCells(workbook)['sheet-1'];
    expect(results.A1).toMatchObject({ kind: 'error', error: '#PARSE!' });
    expect(results.A2).toMatchObject({ kind: 'error', error: '#NAME!' });
    expect(results.A3).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A4).toMatchObject({ kind: 'number', value: 0 });
    expect(results.A5).toMatchObject({ kind: 'number', value: 8 });
    expect(results.A6).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A7).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A8).toMatchObject({ kind: 'error', error: '#PARSE!' });
  });

  it('propagates the first referenced formula error in argument and row-major range order', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(Missing!A1)',
      B1: 'text',
      A2: '=SUM(A1:B1)',
      A3: '=SUM(B1, A1)',
    });
    const workbook = { version: 1 as const, sheets: [inputs] };

    const results = evaluateFormulaCells(workbook)['sheet-1'];
    expect(results.A2).toMatchObject({ kind: 'error', error: '#REF!' });
    expect(results.A3).toMatchObject({ kind: 'error', error: '#REF!' });
  });

  it('resolves references when visited so an earlier argument error wins', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(A1,)',
      A2: '=SUM(A1, Missing!A1)',
      A3: '=SUM(Missing!A1, A1)',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.A2).toMatchObject({ kind: 'error', error: '#PARSE!' });
    expect(results.A3).toMatchObject({ kind: 'error', error: '#REF!' });
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
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

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
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs, outputs] });

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

  it('rejects a range in scalar position and keeps SUM on the shared collection path', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '2',
      A2: 'text',
      A3: 'FALSE',
      A5: '=Missing!A1',
      B1: '=A1:A3',
      B2: '=SUM(1, "2", TRUE, A1:A4)',
      B3: '=SUM(A1:A5)',
    });
    const results = evaluateFormulaCells({ version: 1 as const, sheets: [inputs] })['sheet-1'];

    expect(results.B1).toEqual({ kind: 'error', error: '#VALUE!', display: '#VALUE!' });
    expect(results.B2).toEqual({ kind: 'number', value: 3, display: '3' });
    expect(results.B3).toEqual({ kind: 'error', error: '#REF!', display: '#REF!' });
  });

  it('detects direct, indirect, and cross-sheet cycles without replacing raw formulas', () => {
    const inputs = sheetWithCells('sheet-1', 'Inputs', {
      A1: '=SUM(A1)',
      A2: '=SUM(A3)',
      A3: '=SUM(A2)',
      B1: '=SUM(sheet-2!B1)',
    });
    const outputs = sheetWithCells('sheet-2', 'Outputs', {
      B1: '=SUM(sheet-1!B1)',
    });
    const workbook = { version: 1 as const, sheets: [inputs, outputs] };

    const results = evaluateFormulaCells(workbook);
    expect(results['sheet-1'].A1).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-1'].A2).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-1'].A3).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-1'].B1).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(results['sheet-2'].B1).toMatchObject({ kind: 'error', error: '#CYCLE!' });
    expect(workbook.sheets[0].cells.A1).toBe('=SUM(A1)');
  });
});
