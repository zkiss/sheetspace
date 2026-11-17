import { describe, expect, it } from 'vitest';
import { temporalPickerChange, temporalPickerProjection } from './temporalPicker';

describe('temporal picker adapter', () => {
  it('projects only safely representable values without changing the draft', () => {
    expect(temporalPickerProjection('', 'date')).toEqual({ value: '', exactText: false });
    expect(temporalPickerProjection('2024/02/29', 'date')).toEqual({ value: '2024-02-29', exactText: false });
    expect(temporalPickerProjection('2024-02-29 12:34', 'datetime')).toEqual({ value: '2024-02-29T12:34', exactText: false });
    for (const value of ['2024-02-29 12:34:00', '2024-02-29 12:34:12', ...Array.from({ length: 9 }, (_, i) => `2024-02-29 12:34:12.${'0'.repeat(i + 1)}`), '2024-02', '2023-02-29', '2024-02-29T12:34Z']) {
      expect(temporalPickerProjection(value, 'datetime')).toEqual({ value: '', exactText: true });
    }
  });

  it('accepts intentional valid replacements and clearing but rejects invalid values', () => {
    expect(temporalPickerChange('', 'date')).toBe('');
    expect(temporalPickerChange('2024-02-29', 'date')).toBe('2024-02-29');
    expect(temporalPickerChange('2024-02-29T12:34:00.123456789', 'datetime')).toBe('2024-02-29 12:34:00.123456789');
    expect(temporalPickerChange('2024-02-30', 'date')).toBeUndefined();
    expect(temporalPickerChange('2024-02-29T12:34Z', 'datetime')).toBeUndefined();
  });
});
