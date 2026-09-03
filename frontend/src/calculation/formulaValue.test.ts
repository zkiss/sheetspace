import { describe, expect, it } from 'vitest';
import {
  classifyCellValue,
  displayFormulaValue,
  formulaCollectionValues,
  formulaErrorValue,
  formulaScalarValue,
} from '@calculation/formulaValue';

describe('formula value helpers', () => {
  it('classifies blank, number, boolean, and raw text cells centrally', () => {
    expect(classifyCellValue('')).toEqual({ kind: 'blank' });
    expect(classifyCellValue(' .5e2 ')).toEqual({ kind: 'number', value: 50 });
    expect(classifyCellValue(' false ')).toEqual({ kind: 'boolean', value: false });
    expect(classifyCellValue('   ')).toEqual({ kind: 'text', value: '   ' });
    expect(classifyCellValue('Infinity')).toEqual({ kind: 'text', value: 'Infinity' });
  });

  it('provides shared scalar, collection, error, and display boundaries', () => {
    const range = {
      kind: 'range' as const,
      values: [{ kind: 'number' as const, value: 1 }, { kind: 'blank' as const }],
      rowCount: 2,
      columnCount: 1,
    };

    expect(formulaCollectionValues(range)).toEqual(range.values);
    expect(formulaScalarValue(range)).toEqual({ kind: 'error', error: '#VALUE!' });
    expect(formulaErrorValue('#DIV/0!')).toEqual({ kind: 'error', error: '#DIV/0!' });
    expect(displayFormulaValue({ kind: 'number', value: -0 })).toEqual({
      kind: 'number',
      value: -0,
      display: '0',
    });
  });
});
