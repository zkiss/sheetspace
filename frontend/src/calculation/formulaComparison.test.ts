import { describe, expect, it } from 'vitest';
import {
  applyComparisonOperator,
  compareFormulaScalars,
  isComparisonOperator,
} from '@calculation/formulaComparison';

describe('formula scalar comparison', () => {
  it('recognizes every comparison operator and rejects arbitrary tokens', () => {
    for (const operator of ['=', '<>', '<', '<=', '>', '>=']) {
      expect(isComparisonOperator(operator)).toBe(true);
    }
    expect(isComparisonOperator('!==')).toBe(false);
  });

  it('orders all scalar categories and leaves mixed categories incomparable', () => {
    expect(compareFormulaScalars({ kind: 'number', value: 2 }, { kind: 'number', value: 1 })).toBe(1);
    expect(compareFormulaScalars({ kind: 'boolean', value: true }, { kind: 'boolean', value: false })).toBe(1);
    expect(compareFormulaScalars({ kind: 'blank' }, { kind: 'blank' })).toBe(0);
    expect(compareFormulaScalars({ kind: 'text', value: 'same' }, { kind: 'text', value: 'same' })).toBe(0);
    expect(compareFormulaScalars({ kind: 'number', value: 1 }, { kind: 'text', value: '1' })).toBeUndefined();
  });

  it('compares text by Unicode code points, including equal prefixes and astral characters', () => {
    expect(compareFormulaScalars({ kind: 'text', value: 'a' }, { kind: 'text', value: 'ab' })).toBe(-1);
    expect(compareFormulaScalars({ kind: 'text', value: 'ab' }, { kind: 'text', value: 'a' })).toBe(1);
    expect(compareFormulaScalars({ kind: 'text', value: '\u{10000}' }, { kind: 'text', value: '\u{E000}' })).toBe(1);
  });

  it('applies each operator at equality and either side of it', () => {
    expect(applyComparisonOperator(0, '=')).toBe(true);
    expect(applyComparisonOperator(0, '<>')).toBe(false);
    expect(applyComparisonOperator(-1, '<')).toBe(true);
    expect(applyComparisonOperator(-1, '<=')).toBe(true);
    expect(applyComparisonOperator(1, '>')).toBe(true);
    expect(applyComparisonOperator(1, '>=')).toBe(true);
  });
});
