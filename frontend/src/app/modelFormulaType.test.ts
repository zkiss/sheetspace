import { describe, expect, it } from 'vitest';
import { inferModelFormulaType } from './modelFormulaType';

const columns = [
  { id: 'quantity', name: 'Quantity', kind: 'manual' as const, type: 'int' as const },
  { id: 'price', name: 'Price', kind: 'manual' as const, type: 'float' as const },
  { id: 'total', name: 'Total', kind: 'calculated' as const, type: 'float' as const, formula: '=@Quantity[1]*@Price[1]' },
];

describe('model formula type inference', () => {
  it('infers literals, property expressions, and dependent calculated properties', () => {
    expect(inferModelFormulaType('=1', columns)).toBe('int');
    expect(inferModelFormulaType('=1.5', columns)).toBe('float');
    expect(inferModelFormulaType('=@Quantity[1]+1', columns)).toBe('int');
    expect(inferModelFormulaType('=@Total[1]', columns)).toBe('float');
    expect(inferModelFormulaType('=@Quantity[1]>1', columns)).toBe('boolean');
  });

  it('leaves unknown, cross-sheet, and cyclic expressions untyped', () => {
    const cyclic = [...columns, { id: 'cycle', name: 'Cycle', kind: 'calculated' as const, type: 'float' as const, formula: '=@Cycle[1]' }];

    expect(inferModelFormulaType('=@Missing[1]', columns)).toBeUndefined();
    expect(inferModelFormulaType('=@Other!A[1]', columns)).toBeUndefined();
    expect(inferModelFormulaType('=@Cycle[1]', cyclic)).toBeUndefined();
  });
});
