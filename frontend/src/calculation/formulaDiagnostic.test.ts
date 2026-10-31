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
});
