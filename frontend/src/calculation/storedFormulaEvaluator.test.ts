import { describe, expect, it } from 'vitest';
import { sheetDocument, workbookWithSheets } from '@test-support/workbookFactories';
import { prepareUserFormula } from '@workbook/formula/formulaPreparation';
import { calculationProjection } from '@workbook/read/calculationProjection';
import { evaluateStoredFormulaCells } from './formulaEvaluator';

describe('stored formula evaluation', () => {
  it('evaluates retained identities after rename and reports unresolved targets', () => {
    const source = sheetDocument({ id: 'source', name: 'Source', rowCount: 1, columnCount: 1, cells: { A1: '4' } });
    const output = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 2 });
    const original = workbookWithSheets([source, output]);
    const live = prepareUserFormula('=SUM(@Source!A[1],2)', original, output.id);
    const missing = prepareUserFormula('=@Missing!A[1]', original, output.id);
    const changedOutput = sheetDocument({ id: 'output', name: 'Output', rowCount: 1, columnCount: 2, cells: { A1: live, B1: missing } });
    const changed = workbookWithSheets([{ ...source, name: 'Renamed' }, changedOutput]);

    const result = evaluateStoredFormulaCells(calculationProjection(changed), changed);

    expect(result.output.A1).toMatchObject({ kind: 'number', display: '6' });
    expect(result.output.B1).toMatchObject({ kind: 'error', display: '#REF!' });
  });
});
