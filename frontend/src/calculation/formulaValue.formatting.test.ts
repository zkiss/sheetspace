import { describe, expect, it } from 'vitest';
import { displayFormulaValue, displayRawCellValue } from '@calculation/formulaValue';

describe('number format display', () => {
  it('keeps General byte-compatible with the formula display contract', () => {
    expect(displayFormulaValue({ kind: 'number', value: 1e21 }).display).toBe('1e+21');
    expect(displayFormulaValue({ kind: 'number', value: -0 }).display).toBe('0');
    expect(displayRawCellValue('01.00').display).toBe('1');
  });

  it('renders raw and formula numbers consistently with fixed Number precision', () => {
    const format = { kind: 'number', precision: 2 } as const;
    expect(displayRawCellValue(' 1.005 ', format).display).toBe('1.01');
    expect(displayFormulaValue({ kind: 'number', value: 1.005 }, format).display).toBe('1.01');
    expect(displayFormulaValue({ kind: 'number', value: -0.004 }, format).display).toBe('0.00');
  });

  it('scales Percent before decimal rounding and appends the percent sign', () => {
    expect(displayRawCellValue('0.126', { kind: 'percent', precision: 0 }).display).toBe('13%');
    expect(displayFormulaValue({ kind: 'number', value: 0.126 }, { kind: 'percent', precision: 2 }).display).toBe('12.60%');
  });

  it('never coerces or decorates text, blank, boolean, or error values', () => {
    const percent = { kind: 'percent', precision: 2 } as const;
    expect(displayRawCellValue(' amount ', percent).display).toBe(' amount ');
    expect(displayRawCellValue('', percent).display).toBe('');
    expect(displayRawCellValue('false', percent).display).toBe('FALSE');
    expect(displayFormulaValue({ kind: 'error', error: '#DIV/0!' }, percent).display).toBe('#DIV/0!');
  });

  it('falls back to General for defensive non-finite numeric values', () => {
    const number = { kind: 'number', precision: 2 } as const;
    expect(displayFormulaValue({ kind: 'number', value: Infinity }, number).display).toBe('Infinity');
    expect(displayFormulaValue({ kind: 'number', value: NaN }, { kind: 'percent', precision: 2 }).display).toBe('NaN');
  });
});
