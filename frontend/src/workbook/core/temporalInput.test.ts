import { describe, expect, it } from 'vitest';
import { classifyTemporalInput } from './temporal';

describe('fresh temporal input classification', () => {
  it.each([
    ['2024-02-29', 'date', '2024-02-29'],
    ['2024/02/29', 'date', '2024-02-29'],
    ['0001-01-01', 'date', '0001-01-01'],
    ['9999-12-31', 'date', '9999-12-31'],
    ['2024-02-29T00:00', 'datetime', '2024-02-29 00:00'],
    ['2024/02/29 23:59:59', 'datetime', '2024-02-29 23:59:59'],
    ['2024-02-29 00:00:00.0', 'datetime', '2024-02-29 00:00:00.0'],
    ['2024-02-29 00:00:00.1200', 'datetime', '2024-02-29 00:00:00.1200'],
    ['2024-02-29 00:00:00.123456789', 'datetime', '2024-02-29 00:00:00.123456789'],
  ])('recognizes %s without losing precision', (input, kind, value) => {
    expect(classifyTemporalInput(input)).toEqual({ kind: 'valid', value: { kind, value } });
  });

  it.each([
    '0000-01-01', '1900-02-29', '2023-02-29', '2024-00-01', '2024-13-01', '2024-01-00', '2024-04-31',
    '2024-', '2024/', '2024-2', '2024/2', '2024-02-', '2024/02/', '2024-02-3', '2024/02/3',
    '2024-2-30', '2024/2/30', '2024--29', '2024//29', '2024-02/29', '2024/02-29',
    '2024-02-29T', '2024-02-29 ', '2024-02-29T12:', '2024-02-29T1:00', '2024-02-29 24:00',
    '2024-02-29 12:60', '2024-02-29 12:00:60', '2024-02-29 12:00:00.', '2024-02-29 12:00:00.1234567890',
    '2024-02-29Z', '2024-02-29+01:00', '2024-02-29-01:00', '2024-02-29T00:00Z', '2024-02-2912:00', '2024-02-29 prose',
  ])('rejects malformed year-first intent %s', (input) => {
    expect(classifyTemporalInput(input)).toEqual({ kind: 'invalid' });
  });

  it.each(['', 'hello', '2024-report', '2024', '12:30', '03/04/2026', '=1+2', '@date:2024-02-29', ' 2024-02-29'])(
    'does not infer temporal intent from %s', (input) => {
      expect(classifyTemporalInput(input)).toEqual({ kind: 'not-temporal' });
    },
  );
});
