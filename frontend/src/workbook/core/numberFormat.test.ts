import { describe, expect, it } from 'vitest';
import { cellIdentityKey } from '@workbook/core/cellIdentity';
import {
  APPLICATION_DEFAULT_NUMBER_FORMAT,
  DEFAULT_NUMBER_FORMAT,
  DEFAULT_PERCENT_FORMAT,
  emptySheetFormatOverrides,
  applyFormatWrites,
  isValidNumberFormat,
  isValidNumberFormatPrecision,
  resolveNumberFormat,
  resolveCellAppearance,
  validFormatWrites,
} from '@workbook/core/numberFormat';

describe('number format policy', () => {
  it('defines deterministic defaults and bounded integer precision', () => {
    expect(APPLICATION_DEFAULT_NUMBER_FORMAT).toEqual({ kind: 'general' });
    expect(DEFAULT_NUMBER_FORMAT).toEqual({ kind: 'number', precision: 2 });
    expect(DEFAULT_PERCENT_FORMAT).toEqual({ kind: 'percent', precision: 0 });
    expect([-1, 1.5, 11, NaN, Infinity, '2'].map(isValidNumberFormatPrecision)).toEqual([
      false, false, false, false, false, false,
    ]);
    expect([0, 5, 10].map(isValidNumberFormatPrecision)).toEqual([true, true, true]);
  });

  it('validates the complete coherent property without accepting inapplicable options', () => {
    expect(isValidNumberFormat({ kind: 'general' })).toBe(true);
    expect(isValidNumberFormat({ kind: 'number', precision: 2 })).toBe(true);
    expect(isValidNumberFormat({ kind: 'percent', precision: 10 })).toBe(true);
    expect(isValidNumberFormat({ kind: 'general', precision: 2 })).toBe(false);
    expect(isValidNumberFormat({ kind: 'number' })).toBe(false);
    expect(isValidNumberFormat({ kind: 'number', precision: 2, extra: true })).toBe(false);
    expect(isValidNumberFormat(null)).toBe(false);
  });

  it('resolves cell, row, column, and application scopes against durable identities', () => {
    const identity = { rowId: 'row-a', columnId: 'column-a' };
    const overrides = emptySheetFormatOverrides();
    overrides.columns[identity.columnId] = { numberFormat: DEFAULT_NUMBER_FORMAT };
    expect(resolveNumberFormat(overrides, { rowId: 'row-b', columnId: identity.columnId })).toEqual(DEFAULT_NUMBER_FORMAT);

    overrides.rows[identity.rowId] = { numberFormat: DEFAULT_PERCENT_FORMAT };
    expect(resolveNumberFormat(overrides, identity)).toEqual(DEFAULT_PERCENT_FORMAT);

    overrides.cells[cellIdentityKey(identity)] = { numberFormat: { kind: 'general' } };
    expect(resolveNumberFormat(overrides, identity)).toEqual(APPLICATION_DEFAULT_NUMBER_FORMAT);
  });

  it('reveals the next inherited value when a local property is absent or removed', () => {
    const identity = { rowId: 'toString', columnId: 'column-a' };
    const overrides = emptySheetFormatOverrides();
    overrides.columns[identity.columnId] = { numberFormat: DEFAULT_NUMBER_FORMAT };
    overrides.rows[identity.rowId] = {};
    overrides.cells[cellIdentityKey(identity)] = { numberFormat: { kind: 'general' } };

    expect(resolveNumberFormat(overrides, identity).kind).toBe('general');
    delete overrides.cells[cellIdentityKey(identity)]!.numberFormat;
    expect(resolveNumberFormat(overrides, identity)).toEqual(DEFAULT_NUMBER_FORMAT);
    delete overrides.columns[identity.columnId];
    expect(resolveNumberFormat(overrides, identity)).toEqual(APPLICATION_DEFAULT_NUMBER_FORMAT);
  });

  it('validates and applies sparse writes at each durable scope', () => {
    const row = 'row-a'; const column = 'column-a'; const cell = cellIdentityKey({ rowId: row, columnId: column });
    const writes = [
      { scope: 'row', targetId: row, properties: { numberFormat: { kind: 'percent', precision: 1 } } },
      { scope: 'column', targetId: column, properties: { numberFormat: { kind: 'number', precision: 2 } } },
      { scope: 'cell', targetId: cell, properties: { numberFormat: { kind: 'general' } } },
    ] as const;
    expect(validFormatWrites({ rows: [row], columns: [column] }, writes)).toBe(true);
    expect(applyFormatWrites(undefined, writes)).toEqual({
      rows: { [row]: { numberFormat: { kind: 'percent', precision: 1 } } },
      columns: { [column]: { numberFormat: { kind: 'number', precision: 2 } } },
      cells: { [cell]: { numberFormat: { kind: 'general' } } },
    });
    expect(validFormatWrites({ rows: [row], columns: [column] }, [])).toBe(false);
    expect(validFormatWrites({ rows: [row], columns: [column] }, [...writes, writes[0]])).toBe(false);
    expect(validFormatWrites({ rows: [row], columns: [column] }, [{ scope: 'cell', targetId: 'bad', properties: { numberFormat: null } }])).toBe(false);
    expect(validFormatWrites({ rows: [row], columns: [column] }, [{ scope: 'row', targetId: row, properties: { numberFormat: { kind: 'number', precision: 12 } } }])).toBe(false);
    expect(applyFormatWrites(applyFormatWrites(undefined, writes), [{ scope: 'cell', targetId: cell, properties: { numberFormat: null } }])).toEqual(expect.objectContaining({ cells: {} }));
  });

  it('composes appearance properties independently and preserves explicit defaults', () => {
    const identity = { rowId: 'row-a', columnId: 'column-a' };
    const key = cellIdentityKey(identity);
    const overrides = applyFormatWrites(undefined, [
      { scope: 'column', targetId: identity.columnId, properties: { numberFormat: DEFAULT_NUMBER_FORMAT, fontWeight: 'bold' } },
      { scope: 'row', targetId: identity.rowId, properties: { fontWeight: 'normal', fillColor: '#112233' } },
      { scope: 'cell', targetId: key, properties: { textColor: '#aabbcc' } },
    ]);
    expect(resolveNumberFormat(overrides, identity)).toEqual(DEFAULT_NUMBER_FORMAT);
    expect(resolveCellAppearance(overrides, identity)).toEqual({ numberFormat: DEFAULT_NUMBER_FORMAT, fontWeight: 'normal', horizontalAlignment: 'general', textColor: '#aabbcc', fillColor: '#112233' });
    const inherited = applyFormatWrites(overrides, [{ scope: 'cell', targetId: key, properties: { textColor: null } }]);
    expect(resolveCellAppearance(inherited, identity).textColor).toBe('automatic');
    expect(inherited.rows[identity.rowId]).toEqual({ fontWeight: 'normal', fillColor: '#112233' });
  });

  it('rejects malformed appearance patches without accepting invalid explicit defaults', () => {
    const content = { rows: ['row-a'], columns: ['column-a'] };
    for (const properties of [
      {},
      { fontWeight: 'heavy' },
      { horizontalAlignment: 'justify' },
      { textColor: '#12345' },
      { fillColor: 'transparent' },
      { unexpected: 'value' },
    ]) {
      expect(validFormatWrites(content, [{ scope: 'row', targetId: 'row-a', properties }])).toBe(false);
    }
    expect(validFormatWrites(content, [{ scope: 'row', targetId: 'row-a', properties: { fontWeight: 'normal', horizontalAlignment: 'general', textColor: 'automatic', fillColor: 'none' } }])).toBe(true);
  });
});
