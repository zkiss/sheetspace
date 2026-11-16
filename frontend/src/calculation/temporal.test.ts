import { describe, expect, it } from 'vitest';
import { compareTemporalValues, decodeTemporalValue, encodeTemporalValue, parseTemporalValue } from '@workbook/core/temporal';
import { compareFormulaScalars } from './formulaComparison';
import { classifyCellValue, displayFormulaValue, matchesModelColumnType, materializeFormulaValue } from './formulaValue';
import { compareSortValues } from './sorting';
import { encodeCellTextLiteral } from '@workbook/core/cellLiteral';

describe('local temporal values', () => {
  it('validates Gregorian dates and local times without rollover or offsets', () => {
    for (const input of ['0000-01-01', '1900-02-29', '2024-02-30', '2024-13-01', '03/04/2026', '2024-01-01Z']) {
      expect(parseTemporalValue(input, 'date')).toBeUndefined();
    }
    for (const input of ['2024-01-01 24:00', '2024-01-01 12:60', '2024-01-01 12:00:60', '2024-01-01T12:00Z', '2024-01-01 12:00:00.1234567890', '2024-01-01']) {
      expect(parseTemporalValue(input, 'datetime')).toBeUndefined();
    }
    expect(parseTemporalValue('2000/02/29', 'date')).toEqual({ kind: 'date', value: '2000-02-29' });
    expect(parseTemporalValue('9999-12-31T23:59:59.123400000', 'datetime')).toEqual({ kind: 'datetime', value: '9999-12-31 23:59:59.123400000' });
  });

  it('rejects mixed date separators in both temporal kinds', () => {
    for (const date of ['2024-01/02', '2024/01-02']) {
      expect(parseTemporalValue(date, 'date')).toBeUndefined();
      expect(parseTemporalValue(`${date} 12:30`, 'datetime')).toBeUndefined();
    }
  });

  it('roundtrips typed storage without confusing explicit text and ignores number formatting', () => {
    const value = parseTemporalValue('2024/02/29T12:30:00.100', 'datetime')!;
    const raw = encodeTemporalValue(value);
    expect(decodeTemporalValue(raw)).toEqual(value);
    expect(decodeTemporalValue('@date:2024/02/29')).toBeUndefined();
    expect(decodeTemporalValue('@date:2023-02-29')).toBeUndefined();
    expect(classifyCellValue(materializeFormulaValue(value))).toEqual(value);
    expect(classifyCellValue(encodeCellTextLiteral(raw))).toEqual({ kind: 'text', value: raw });
    expect(displayFormulaValue(value, { kind: 'percent', precision: 2 }).display).toBe(value.value);
    for (const type of ['string', 'boolean', 'float', 'int'] as const) expect(matchesModelColumnType(value, type)).toBe(false);
  });

  it('compares matching types chronologically with precision-independent ties', () => {
    const early = parseTemporalValue('1999-12-31 23:59', 'datetime')!;
    const later = parseTemporalValue('2000-01-01 00:00:00.000', 'datetime')!;
    expect(compareTemporalValues(early.value, later.value)).toBe(-1);
    expect(compareFormulaScalars(early, later)).toBe(-1);
    expect(compareFormulaScalars(later, parseTemporalValue('2000-01-01 00:00', 'datetime')!)).toBe(0);
    expect(compareFormulaScalars(later, parseTemporalValue('2000-01-01', 'date')!)).toBeUndefined();
    expect([later, early].sort(compareSortValues)).toEqual([early, later]);
    expect([early, later].sort((a, b) => -compareSortValues(a, b))).toEqual([later, early]);
  });
});
