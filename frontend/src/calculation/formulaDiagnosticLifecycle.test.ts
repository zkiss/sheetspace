import { describe, expect, it } from 'vitest';
import { FormulaCalculation } from '@calculation/formulaCalculation';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';

describe('diagnostic lifecycle', () => {
  it('preserves typed input provenance through a calculated model column and clears it after correction', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: 'three', B1: '=@A[1]*2' } });
    const projection = calculationProjection(workbookWithSheets([sheet]));
    const source = projection.sheets[0];
    const input = cellIdentityKey({ rowId: source.rows[0], columnId: source.columns[0] });
    const output = cellIdentityKey({ rowId: source.rows[0], columnId: source.columns[1] });
    const typed = { ...source, columnTypes: { [source.columns[0]]: 'int' as const, [source.columns[1]]: 'int' as const } };
    const calculation = new FormulaCalculation();
    calculation.update({ sheets: [typed] }, { kind: 'structure' });
    expect(calculation.diagnostic(sheet.id, output)).toMatchObject({
      message: 'Propagated #VALUE!',
      cell: { sheetId: sheet.id, rowId: source.rows[0], columnId: source.columns[1] },
      causes: [{ message: 'Expected int, got text "three".', cell: { sheetId: sheet.id, rowId: source.rows[0], columnId: source.columns[0] } }],
    });
    calculation.update({ sheets: [{ ...typed, cells: { ...typed.cells, [input]: '3' } }] }, { kind: 'cells', cells: [{ sheetId: sheet.id, key: 'A1' }] });
    expect(calculation.diagnostic(sheet.id, output)).toBeUndefined();
    expect(calculation.diagnostic(sheet.id, input)).toBeUndefined();
  });

  it('keeps the original stable identity when a structural insertion moves an error', () => {
    const sheet = sheetDocument({ id: 'inputs', name: 'Inputs', cells: { A1: '=1/0' } });
    const projection = calculationProjection(workbookWithSheets([sheet]));
    const source = projection.sheets[0];
    const key = cellIdentityKey({ rowId: source.rows[0], columnId: source.columns[0] });
    const calculation = new FormulaCalculation();
    calculation.update(projection, { kind: 'structure' });
    const snapshot = calculation.update({ sheets: [{ ...source, rows: ['inserted-row', ...source.rows] }] }, { kind: 'structure' });
    expect(snapshot.inputs.A2).toMatchObject({ kind: 'error', error: '#DIV/0!' });
    expect(calculation.diagnostic(sheet.id, key)).toMatchObject({
      message: 'Cannot divide 1 by zero.',
      cell: { sheetId: sheet.id, rowId: source.rows[0], columnId: source.columns[0] },
    });
  });
});
