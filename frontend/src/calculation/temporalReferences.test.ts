import { describe, expect, it } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('temporal references', () => {
  it('propagates local values through references and rejects arithmetic and mixed comparisons', () => {
    const workbook = workbookWithSheets([
      sheetDocument({ id: 'first', name: 'First', cells: {
        A1: '@date:1999-12-31', A2: '@datetime:2000-01-01 00:00',
        B1: '=@A[1]', B2: '=@second!A[1]', C1: '=@A[1]+1', C2: '=@A[1]=@A[2]',
        D1: '=IF(TRUE,@A[1],@A[2])', D2: '=IF(FALSE,@A[1],@A[2])',
        E1: '=COUNTA(@A[1]:A[2])', E2: '=COUNT(@A[1]:A[2])',
      } }),
      sheetDocument({ id: 'second', name: 'Second', cells: { A1: '@datetime:2024-02-29 12:30:00.100' } }),
    ]);
    const result = new FormulaCalculation().update(calculationProjection(workbook), { kind: 'structure' });
    expect(result.first!.B1).toMatchObject({ kind: 'date', value: '1999-12-31' });
    expect(result.first!.B2).toMatchObject({ kind: 'datetime', value: '2024-02-29 12:30:00.100' });
    expect(result.first!.C1).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(result.first!.C2).toMatchObject({ kind: 'error', error: '#VALUE!' });
    expect(result.first!.D1).toMatchObject({ kind: 'date', value: '1999-12-31' });
    expect(result.first!.D2).toMatchObject({ kind: 'datetime', value: '2000-01-01 00:00' });
    expect(result.first!.E1).toMatchObject({ kind: 'number', value: 2 });
    expect(result.first!.E2).toMatchObject({ kind: 'number', value: 0 });
  });
});
