import { describe, expect, it } from 'vitest';
import {
  cellKey,
  columnIndexToLabel,
  columnLabelToIndex,
  expandRange,
  parseA1Address,
  parseA1Range,
} from './workbook/core/address';

const bounds = { columnCount: 10, rowCount: 20 };

describe('column labels', () => {
  it.each([
    [0, 'A'],
    [1, 'B'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
  ])('converts zero-based index %i to %s and back', (index, label) => {
    expect(columnIndexToLabel(index)).toBe(label);
    expect(columnLabelToIndex(label)).toEqual({ ok: true, value: index });
  });

  it('accepts lowercase labels', () => {
    expect(columnLabelToIndex('z')).toEqual({ ok: true, value: 25 });
  });

  it.each([-1, 1.5])('rejects invalid column index %s', (index) => {
    expect(() => columnIndexToLabel(index)).toThrow(
      'Column index must be a non-negative integer.',
    );
  });
});

describe('A1 addresses', () => {
  it('normalizes address case and converts addresses back to cell keys', () => {
    expect(parseA1Address('a1')).toEqual({
      ok: true,
      value: { columnIndex: 0, rowIndex: 0 },
    });
    expect(parseA1Address('AB20')).toEqual({
      ok: true,
      value: { columnIndex: 27, rowIndex: 19 },
    });
    expect(cellKey({ columnIndex: 27, rowIndex: 19 })).toBe('AB20');
  });

  it('distinguishes malformed and out-of-bounds addresses', () => {
    expect(parseA1Address('A 1', bounds)).toEqual({
      ok: false,
      reason: 'invalid-format',
    });
    expect(parseA1Address('A0', bounds)).toEqual({
      ok: false,
      reason: 'invalid-format',
    });
    expect(parseA1Address('K1', bounds)).toEqual({
      ok: false,
      reason: 'out-of-bounds',
    });
    expect(parseA1Address('A21', bounds)).toEqual({
      ok: false,
      reason: 'out-of-bounds',
    });
  });
});

describe('A1 ranges', () => {
  it('normalizes reversed ranges', () => {
    expect(parseA1Range('C2:A1', bounds)).toEqual({
      ok: true,
      value: {
        start: { columnIndex: 0, rowIndex: 0 },
        end: { columnIndex: 2, rowIndex: 1 },
      },
    });
  });

  it('expands ranges in row-major order', () => {
    expect(expandRange({
      start: { columnIndex: 0, rowIndex: 0 },
      end: { columnIndex: 2, rowIndex: 1 },
    }, bounds)).toEqual({
      ok: true,
      value: [
        { columnIndex: 0, rowIndex: 0 },
        { columnIndex: 1, rowIndex: 0 },
        { columnIndex: 2, rowIndex: 0 },
        { columnIndex: 0, rowIndex: 1 },
        { columnIndex: 1, rowIndex: 1 },
        { columnIndex: 2, rowIndex: 1 },
      ],
    });
  });

  it('rejects malformed and out-of-bounds ranges', () => {
    expect(parseA1Range('A1', bounds)).toEqual({
      ok: false,
      reason: 'invalid-format',
    });
    expect(parseA1Range('A1:K1', bounds)).toEqual({
      ok: false,
      reason: 'out-of-bounds',
    });
    expect(expandRange({
      start: { columnIndex: 0, rowIndex: 0 },
      end: { columnIndex: 10, rowIndex: 0 },
    }, bounds)).toEqual({
      ok: false,
      reason: 'out-of-bounds',
    });
  });
});
