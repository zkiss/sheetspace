import { describe, expect, it } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { FormulaEvaluator } from '@calculation/formulaEvaluator';
import { formulaDiagnostic } from '@calculation/formulaValue';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('calculation diagnostics', () => {
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
      message: 'Propagated #CYCLE!', cell: { columnId: sheet.content.columns[3] },
      causes: [{ message: 'Propagated #CYCLE!', cell: { columnId: sheet.content.columns[2] }, causes: [
        { message: 'Cycle detected; the dependency path cannot be evaluated.', cell: { columnId: sheet.content.columns[0] }, causes: [] },
      ] }],
    });
  });
});
