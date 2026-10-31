import { describe, expect, it } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { FormulaEvaluator } from '@calculation/formulaEvaluator';
import { diagnosticAtCell, diagnosticError, formulaDiagnostic, formulaErrorValue } from '@calculation/formulaValue';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('calculation diagnostics', () => {
  it('attaches a stable cell to bare errors without duplicating an existing frame', () => {
    const cell = { sheetId: 'sheet', rowId: 'row', columnId: 'column' };
    const bare = formulaErrorValue('#VALUE!');
    expect(diagnosticAtCell(bare, undefined)).toBe(bare);
    const attached = diagnosticAtCell(bare, cell);
    expect(formulaDiagnostic(attached)).toEqual({ message: '#VALUE!', cell, causes: [] });
    expect(diagnosticAtCell(attached, cell)).toBe(attached);
    const explained = diagnosticError('#REF!', 'Missing target.');
    expect(formulaDiagnostic(diagnosticAtCell(explained, cell))).toEqual({ message: 'Missing target.', cell, causes: [] });
  });
  it('explains parse, function and operand validation failures with evaluated values', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const evaluator = new FormulaEvaluator(calculationProjection(workbookWithSheets([sheet])));
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=1+', 'inputs'))?.message).toContain('parse');
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=MISSING(1)', 'inputs'))?.message).toBe('Unknown function MISSING.');
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=ABS(1,2)', 'inputs'))?.message).toBe('ABS expected 1 arguments, got 2.');
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=1+"three"', 'inputs'))?.message).toBe('Cannot apply + to number 1 and text "three": expected numbers.');
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=1="one"', 'inputs'))?.message).toBe('Cannot compare number 1 with text "one": expected matching types.');
  });
  it('preserves failures from unary and right-hand operands and explains invalid ranges', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0' } });
    const evaluator = new FormulaEvaluator(calculationProjection(workbookWithSheets([sheet])));
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=-@A[1]', 'inputs'))?.message).toBe('Cannot divide 1 by zero.');
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=1+@A[1]', 'inputs'))?.message).toBe('Cannot divide 1 by zero.');
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=-"bad"', 'inputs'))?.message).toBe('Expected a number, got text "bad".');
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=@A[1]:A[999]', 'inputs'))?.message).toBe('Referenced range does not exist.');
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=1e308*1e308', 'inputs'))?.message).toContain('Nonfinite result');
  });
  it('explains a parser returning a non-formula for a formula cell', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1' } });
    const evaluator = new FormulaEvaluator(
      calculationProjection(workbookWithSheets([sheet])),
      new Map(), undefined, undefined,
      () => ({ kind: 'not-formula', raw: '=1' }),
    );
    expect(formulaDiagnostic(evaluator.evaluate().inputs.A1)?.message).toBe('Parser did not return a formula.');
  });
  it('explains conditional aggregate validation without evaluating rejected ranges', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0', B1: '=SUMIF(@A[1]:A[2],">0",@A[1])', B2: '=COUNTIF(@A[3],">")', B3: '=COUNTIF(@Missing!A[1],1)' } });
    const calculation = new FormulaCalculation();
    const snapshot = calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    expect(formulaDiagnostic(snapshot.inputs.B1)?.message).toContain('criteria shape 2x1 does not match sum shape 1x1');
    expect(formulaDiagnostic(snapshot.inputs.B2)?.message).toContain('Invalid criterion ">"');
    expect(formulaDiagnostic(snapshot.inputs.B3)?.message).toContain('Referenced sheet does not exist');
  });
  it('explains conditional aggregate failures at each evaluated boundary', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0', A2: '1' } });
    const evaluator = new FormulaEvaluator(calculationProjection(workbookWithSheets([sheet])));
    const message = (expression: string) => formulaDiagnostic(evaluator.evaluateExpressionContent(expression, 'inputs'))?.message;
    expect(message('=SUMIF(@A[1],1)')).toBe('Cannot divide 1 by zero.');
    expect(message('=SUMIF(@A[2],@A[1])')).toBe('Cannot divide 1 by zero.');
    expect(message('=SUMIF(@A[2],">")')).toContain('Invalid criterion');
    expect(message('=SUMIF(@Missing!A[1],1)')).toContain('Referenced sheet does not exist');
    expect(message('=SUMIF(@A[2],1,@Missing!A[1])')).toContain('Referenced sheet does not exist');
    expect(message('=COUNTIF(@A[2],@A[1])')).toBe('Cannot divide 1 by zero.');
    expect(message('=COUNTIF(@A[1],1)')).toBe('Cannot divide 1 by zero.');
    expect(message('=SUMIF(@A[1]:A[2],1,@A[2])')).toContain('does not match');
  });
  it('explains blank logical inputs and overflowing aggregate operands', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { B1: '=AND(@A[1])', B2: '=SUM(1e308,1e308)', B3: '=AVERAGE(1e308,1e308)' } });
    const calculation = new FormulaCalculation();
    const snapshot = calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    expect(formulaDiagnostic(snapshot.inputs.B1)?.message).toContain('at least one boolean');
    expect(formulaDiagnostic(snapshot.inputs.B2)?.message).toContain('adding 1e+308 to 1e+308');
    expect(formulaDiagnostic(snapshot.inputs.B3)?.message).toContain('adding 1e+308 to 1e+308');
  });

  it('retains only matched sum-range failures as sibling causes', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '1', A2: '1', A3: '0', B1: '=1/0', B2: '=2/0', B3: '=3/0', C1: '=SUMIF(@A[1]:A[3],">0",@B[1]:B[3])' } });
    const calculation = new FormulaCalculation();
    const snapshot = calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    expect(formulaDiagnostic(snapshot.inputs.C1)).toMatchObject({ message: 'Multiple matched sum cells failed.', causes: [{ message: 'Cannot divide 1 by zero.' }, { message: 'Cannot divide 2 by zero.' }] });
  });
  it('explains a range used where a scalar is required without evaluating its cells', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0', A2: '=2/0' } });
    const evaluated: string[] = [];
    const evaluator = new FormulaEvaluator(calculationProjection(workbookWithSheets([sheet])), new Map(), (_sheet, key) => evaluated.push(key));
    const result = evaluator.evaluateExpressionContent('=@A[1]:A[2]+1', 'inputs');
    expect(formulaDiagnostic(result)).toEqual({ message: 'Expected a scalar value, got a 2 by 1 range.', causes: [] });
    expect(evaluated).toEqual([]);
  });
  it('preserves independent errors encountered while materializing conditional criteria', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0', A2: '=2/0', B1: '=COUNTIF(@A[1]:A[2],">0")' } });
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[1] });
    expect(calculation.diagnostic(sheet.id, key)).toMatchObject({
      message: 'Multiple criteria cells failed.',
      causes: [{ message: 'Cannot divide 1 by zero.' }, { message: 'Cannot divide 2 by zero.' }],
    });
  });
  it('reports the actual operands that overflow a conditional sum', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '1e308', A2: '1e308', B1: '=SUMIF(@A[1]:A[2],">0")' } });
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[1] });
    expect(calculation.diagnostic(sheet.id, key)).toMatchObject({
      message: 'SUMIF produced a nonfinite result adding 1e+308 to 1e+308.',
    });
  });
  it('preserves the evaluated operand and stable identity through a propagated error', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0', B1: '=@A[1]' } });
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[1] });
    expect(calculation.diagnostic('inputs', key)).toMatchObject({
      message: 'Propagated #DIV/0!',
      cell: { sheetId: 'inputs', rowId: sheet.content.rows[0], columnId: sheet.content.columns[1] },
      causes: [{ message: 'Cannot divide 1 by zero.', cell: { sheetId: 'inputs', columnId: sheet.content.columns[0] } }],
    });
  });

  it('exposes the same diagnostic on workbook-facing display results', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0', B1: '=@A[1]' } });
    const calculation = new FormulaCalculation();
    const snapshot = calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[1] });
    expect(formulaDiagnostic(snapshot.inputs.B1)).toEqual(calculation.diagnostic('inputs', key));
    expect(formulaDiagnostic(snapshot.inputs.B1)).toMatchObject({ causes: [{ message: 'Cannot divide 1 by zero.' }] });
  });

  it('retains ordered stable identities across sheets and reuses unaffected diagnostics', () => {
    const inputs = sheetDocument({ id: 'sheet-inputs', name: 'Inputs', cells: { A1: '=1/0' } });
    const summary = sheetDocument({ id: 'sheet-summary', name: 'Summary', cells: { A1: '=@sheet-inputs!A[1]', B1: '=@A[1]', C1: '=1' } });
    const calculation = new FormulaCalculation();
    const projection = calculationProjection(workbookWithSheets([inputs, summary]));
    calculation.update(projection, { kind: 'structure' });
    const key = cellIdentityKey({ rowId: summary.content.rows[0], columnId: summary.content.columns[1] });
    const diagnostic = calculation.diagnostic(summary.id, key);
    expect(diagnostic).toMatchObject({
      cell: { sheetId: summary.id, columnId: summary.content.columns[1] },
      causes: [{ cell: { sheetId: summary.id, columnId: summary.content.columns[0] }, causes: [
        { cell: { sheetId: inputs.id, columnId: inputs.content.columns[0] }, message: 'Cannot divide 1 by zero.' },
      ] }],
    });
    const evaluated: string[] = [];
    calculation.update(projection, { kind: 'cells', cells: [{ sheetId: summary.id, key: 'C1' }] }, (_sheet, cell) => evaluated.push(cell));
    expect(calculation.diagnostic(summary.id, key)).toBe(diagnostic);
    expect(evaluated).toEqual(['C1']);
  });

  it('does not report failures from an inactive conditional expression', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=IF(TRUE,1,1/0)' } });
    const calculation = new FormulaCalculation();
    const snapshot = calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[0] });
    expect(snapshot.inputs.A1).toMatchObject({ kind: 'number', value: 1 });
    expect(calculation.diagnostic(sheet.id, key)).toBeUndefined();
  });

  it('reports an inactive cycle reference as structural blocking without evaluating either expression', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=@A[1]', B1: '=IF(FALSE,@A[1],7)' } });
    const evaluated: string[] = [];
    const calculation = new FormulaCalculation();
    const snapshot = calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' }, (_sheet, key) => evaluated.push(key));
    expect(evaluated).toEqual([]);
    expect(formulaDiagnostic(snapshot.inputs.B1)).toMatchObject({
      message: 'Structural dependency on a cycle; expression blocked before evaluation.',
      causes: [{ message: 'Structural dependency cycle detected; expression blocked before evaluation.', causes: [] }],
    });
  });

  it('keeps independent evaluated failures in separate branches', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0', B1: '=2/0', C1: '=@A[1]+@B[1]' } });
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[2] });
    expect(calculation.diagnostic('inputs', key)).toMatchObject({
      message: 'Multiple operands failed (#DIV/0!, #DIV/0!).',
      causes: [{ message: 'Cannot divide 1 by zero.' }, { message: 'Cannot divide 2 by zero.' }],
    });
  });

  it('explains a detached out-of-bounds reference without inventing an origin', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const evaluator = new FormulaEvaluator(calculationProjection(workbookWithSheets([sheet])));
    const result = evaluator.evaluateExpressionContent('=@Z[999]', 'inputs');
    expect(result).toEqual({ kind: 'error', error: '#REF!' });
    expect(formulaDiagnostic(result)).toEqual({ message: 'Referenced cell does not exist.', causes: [] });
  });

  it('records independent eager function argument failures without reevaluating cells', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0', B1: '=2/0', C1: '=SUM(@A[1],@B[1])' } });
    const evaluated: string[] = [];
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' }, (_sheet, key) => evaluated.push(key));
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[2] });
    expect(calculation.diagnostic('inputs', key)).toMatchObject({
      message: 'SUM has multiple failing arguments.',
      causes: [{ message: 'Cannot divide 1 by zero.' }, { message: 'Cannot divide 2 by zero.' }],
    });
    expect(evaluated.sort()).toEqual(['A1', 'B1', 'C1']);
  });

  it('keeps independent failures within an eager range in separate branches', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0', A2: '=2/0', B1: '=SUM(@A[1]:A[2])' } });
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[1] });
    expect(calculation.diagnostic('inputs', key)).toMatchObject({
      message: 'Multiple cells in the range failed.',
      causes: [{ message: 'Cannot divide 1 by zero.' }, { message: 'Cannot divide 2 by zero.' }],
    });
  });

  it('reports actual values at numeric function validation', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const evaluator = new FormulaEvaluator(calculationProjection(workbookWithSheets([sheet])));
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=ABS("three")', 'inputs'))).toMatchObject({ message: 'Expected a number, got text "three".' });
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=SQRT(-2)', 'inputs'))).toMatchObject({ message: 'Invalid numeric argument -2.' });
  });

  it('preserves referenced errors through conditional aggregate inputs', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: {
      A1: '=1/0', B1: '=COUNTIF(@A[1]:A[2],1)', C1: '=SUMIF(@A[2]:A[2],@A[1])',
    } });
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    for (const column of [1, 2]) {
      const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[column] });
      expect(calculation.diagnostic('inputs', key)).toMatchObject({
        message: 'Propagated #DIV/0!', causes: [{ message: 'Cannot divide 1 by zero.', cell: { columnId: sheet.content.columns[0] } }],
      });
    }
  });

  it('explains the actual invalid logical input', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs' });
    const evaluator = new FormulaEvaluator(calculationProjection(workbookWithSheets([sheet])));
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=IF("no",1,2)', 'inputs'))).toMatchObject({ message: 'Expected a boolean, got text "no".' });
    expect(formulaDiagnostic(evaluator.evaluateExpressionContent('=NOT(12)', 'inputs'))).toMatchObject({ message: 'Expected a boolean, got number 12.' });
  });

  it('clears dependent diagnostics after an incremental correction without changing a fork', () => {
    const original = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0', B1: '=@A[1]' } });
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([original])), { kind: 'structure' });
    const fork = calculation.fork();
    const key = cellIdentityKey({ rowId: original.content.rows[0], columnId: original.content.columns[1] });
    const corrected = { ...original, content: { ...original.content, cells: { ...original.content.cells, [cellIdentityKey({ rowId: original.content.rows[0], columnId: original.content.columns[0] })]: '2' } } };
    calculation.update(calculationProjection(workbookWithSheets([corrected])), { kind: 'cells', cells: [{ sheetId: 'inputs', key: 'A1' }] });
    expect(calculation.diagnostic('inputs', key)).toBeUndefined();
    expect(fork.diagnostic('inputs', key)).toMatchObject({ causes: [{ message: 'Cannot divide 1 by zero.' }] });
  });

  it('retains the dependency path from a cycle-dependent cell to a bounded cycle marker', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=@B[1]', B1: '=@A[1]', C1: '=@A[1]', D1: '=@C[1]' } });
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[3] });
    expect(calculation.diagnostic('inputs', key)).toMatchObject({
      message: 'Structural dependency on a cycle; expression blocked before evaluation.', cell: { columnId: sheet.content.columns[3] },
      causes: [{ message: 'Structural dependency on a cycle; expression blocked before evaluation.', cell: { columnId: sheet.content.columns[2] }, causes: [
        { message: 'Structural dependency cycle detected; expression blocked before evaluation.', cell: { columnId: sheet.content.columns[0] }, causes: [{ cell: { columnId: sheet.content.columns[1] }, causes: [] }] },
      ] }],
    });
  });

  it('preserves converging branches to a cycle and exposes every cycle member', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=@B[1]', B1: '=@A[1]', C1: '=@A[1]', D1: '=@A[1]', E1: '=@C[1]+@D[1]' } });
    const calculation = new FormulaCalculation();
    const evaluated: string[] = [];
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' }, (_sheet, key) => evaluated.push(key));
    const diagnostic = (column: number) => calculation.diagnostic('inputs', cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[column] }));
    const cycle = { cell: { columnId: sheet.content.columns[0] }, causes: [
      { cell: { columnId: sheet.content.columns[1] }, causes: [] },
    ] };
    expect(diagnostic(0)).toMatchObject(cycle);
    expect(diagnostic(4)).toMatchObject({ causes: [
      { cell: { columnId: sheet.content.columns[2] }, causes: [cycle] },
      { cell: { columnId: sheet.content.columns[3] }, causes: [cycle] },
    ] });
    expect(evaluated).toEqual([]);
  });

  it('keeps separate dependency paths to independent cycles', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=@A[1]', B1: '=@B[1]', C1: '=@A[1]+@B[1]' } });
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[2] });
    expect(calculation.diagnostic('inputs', key)).toMatchObject({
      message: 'Structural dependency on a cycle; expression blocked before evaluation.',
      causes: [
        { cell: { columnId: sheet.content.columns[0] }, message: 'Structural dependency cycle detected; expression blocked before evaluation.' },
        { cell: { columnId: sheet.content.columns[1] }, message: 'Structural dependency cycle detected; expression blocked before evaluation.' },
      ],
    });
  });

  it('reports a cross-sheet range cycle as bounded structural evidence', () => {
    const inputs = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=SUM(@summary!A[1]:A[2])' } });
    const summary = sheetDocument({ id: 'summary', name: 'Summary', cells: { A1: '=@inputs!A[1]', B1: '=@A[1]' } });
    const evaluated: string[] = [];
    const calculation = new FormulaCalculation();
    const result = calculation.update(calculationProjection(workbookWithSheets([inputs, summary])), { kind: 'structure' }, (_sheet, key) => evaluated.push(key));
    expect(evaluated).toEqual([]);
    expect(formulaDiagnostic(result.summary.B1)).toMatchObject({
      message: 'Structural dependency on a cycle; expression blocked before evaluation.',
      causes: [{ cell: { sheetId: 'summary', rowId: summary.content.rows[0], columnId: summary.content.columns[0] },
        message: 'Structural dependency cycle detected; expression blocked before evaluation.', causes: [{ cell: { sheetId: 'inputs' }, causes: [] }] }],
    });
  });

  it('retains witnesses to independent cycles at unequal dependency distances', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=@A[1]', B1: '=@B[1]', C1: '=@B[1]', D1: '=@A[1]+@C[1]' } });
    const calculation = new FormulaCalculation();
    calculation.update(calculationProjection(workbookWithSheets([sheet])), { kind: 'structure' });
    const key = cellIdentityKey({ rowId: sheet.content.rows[0], columnId: sheet.content.columns[3] });
    expect(calculation.diagnostic('inputs', key)).toMatchObject({ causes: [
      { cell: { columnId: sheet.content.columns[0] }, causes: [] },
      { cell: { columnId: sheet.content.columns[2] }, causes: [
        { cell: { columnId: sheet.content.columns[1] }, causes: [] },
      ] },
    ] });
  });
});
