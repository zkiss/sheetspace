import { describe, expect, it } from 'vitest';
import { cellIdentityFromKey, cellIdentityKey } from '@workbook/core/cellIdentity';
import { APPLICATION_DEFAULT_APPEARANCE, emptySheetFormatOverrides, resolveAppearanceProperty } from '@workbook/core/numberFormat';
import type { CellAppearance, SheetFormatOverrides } from '@workbook/core/model';
import { appearanceVariant, coverageKeys, formattingFixture, formattingValues } from '@test-support/formattingSummaryFixtures';
import { formattingProperties, summarizeFormattingDense, summarizeFormattingSparse } from './formattingSummary';
import type { ValidFormattingSelection } from './formattingSelection';
import type { SparseFormattingMetrics } from './formattingSummarySparse';

function compare(selection: ValidFormattingSelection, source: SheetFormatOverrides) {
  const dense = summarizeFormattingDense(selection, source);
  const metrics = {} as SparseFormattingMetrics;
  expect(summarizeFormattingSparse(selection, source, metrics)).toEqual(dense);
  expect(metrics.effectiveTotals).toEqual(Array(5).fill(selection.effectiveSize));
  expect(metrics.minimumEffectiveCount).toBeGreaterThan(0);
  // Independently enumerate core lookups and explicit precedence on bounded fixtures.
  // Neither histogram math nor dense accumulators determine this expectation.
  const own = (records: Record<string, CellAppearance>, id: string) => Object.prototype.hasOwnProperty.call(records, id) ? records[id] : undefined;
  for (const property of formattingProperties) {
    const values = new Map<string, unknown>();
    for (const key of coverageKeys(selection)) {
      const identity = cellIdentityFromKey(key)!;
      const expected = own(source.cells, key)?.[property] ?? own(source.rows, identity.rowId)?.[property]
        ?? own(source.columns, identity.columnId)?.[property] ?? APPLICATION_DEFAULT_APPEARANCE[property];
      const value = resolveAppearanceProperty(source, identity, property);
      expect(value).toEqual(expected);
      values.set(JSON.stringify(value), value);
    }
    expect(dense[property].effectiveValue).toEqual(values.size === 1 ? values.values().next().value : null);
  }
  return dense;
}

describe.each(['cells', 'rows', 'columns'] as const)('%s dense/sparse differential', (mode) => {
  it.each(formattingProperties)('counts 0, 1, E-1 and E cell masks for %s without premature mixtures', (property) => {
    const { sheet, selection } = formattingFixture(mode, 4, 5, 2, 2);
    const keys = coverageKeys(selection);
    for (const count of [0, 1, keys.length - 1, keys.length]) {
      const source = emptySheetFormatOverrides();
      for (const row of sheet.content.rows) source.rows[row] = { [property]: formattingValues[property][0] };
      for (const column of sheet.content.columns) source.columns[column] = { [property]: formattingValues[property][1] };
      for (const key of keys.slice(0, count)) source.cells[key] = { [property]: APPLICATION_DEFAULT_APPEARANCE[property] };
      const summary = compare(selection, source)[property];
      expect(summary.effectiveValue).toEqual(count === keys.length ? APPLICATION_DEFAULT_APPEARANCE[property] : count === 0 ? formattingValues[property][0] : null);
      expect(summary.hasLocalOverrides).toBe(mode === 'cells' ? count > 0 : true);
      if (mode !== 'cells') expect(summary.localOverrideState).toBe('explicit');
    }
  });

  it('erases conflicting row/column bins completely or partly and keeps partial properties independent', () => {
    const { sheet, selection } = formattingFixture(mode, 4, 5, 2, 2);
    const source = emptySheetFormatOverrides();
    source.rows[sheet.content.rows[0]!] = appearanceVariant();
    for (const column of sheet.content.columns) source.columns[column] = appearanceVariant(1);
    const keys = coverageKeys(selection);
    for (const key of keys) source.cells[key] = { ...APPLICATION_DEFAULT_APPEARANCE };
    const uniform = compare(selection, source);
    for (const property of formattingProperties) expect(uniform[property].effectiveValue).toEqual(APPLICATION_DEFAULT_APPEARANCE[property]);
    // Last position has only fill: all four other properties reveal their baseline.
    source.cells[keys[keys.length - 1]!] = { fillColor: 'none' };
    const partial = compare(selection, source);
    expect(partial.fillColor.effectiveValue).toBe('none');
    expect(partial.numberFormat.effectiveValue).toBeNull();
  });

  it('distinguishes uniform effective values from mixed local provenance and finds late exceptions', () => {
    const { sheet, selection } = formattingFixture(mode, 20, 20, 2, 2);
    const source = emptySheetFormatOverrides();
    for (const id of sheet.content.columns) source.columns[id] = appearanceVariant();
    const locals = mode === 'cells' ? source.cells : mode === 'rows' ? source.rows : source.columns;
    // For columns, row inheritance supplies uniformity despite an absent column local.
    if (mode === 'columns') {
      for (const id of sheet.content.rows) source.rows[id] = appearanceVariant();
      delete locals[sheet.content.columns[0]!];
    } else locals[mode === 'cells' ? coverageKeys(selection)[0]! : sheet.content.rows[0]!] = appearanceVariant();
    const uniform = compare(selection, source);
    for (const property of formattingProperties) expect(uniform[property]).toMatchObject({ effectiveValue: appearanceVariant()[property], localOverrideState: 'mixed', hasLocalOverrides: true });
    const keys = coverageKeys(selection);
    source.cells[keys[keys.length - 1]!] = { ...APPLICATION_DEFAULT_APPEARANCE };
    const late = compare(selection, source);
    for (const property of formattingProperties) expect(late[property].effectiveValue).toBeNull();
  });

  it('ignores malformed, outside, dead and inherited records; handles prototype-name IDs and reorder', () => {
    const fixture = formattingFixture(mode, 5, 6, 2, 2);
    fixture.sheet.content.rows[0] = 'toString'; fixture.sheet.content.columns[0] = '__proto__';
    fixture.input.extent.cell = { rowId: 'toString', columnId: '__proto__' };
    const source = emptySheetFormatOverrides();
    source.rows = Object.create({ toString: appearanceVariant() });
    source.columns = Object.create({ __proto__: appearanceVariant() });
    source.cells = Object.create({ [cellIdentityKey(fixture.input.extent.cell)]: appearanceVariant() });
    for (const key of ['malformed', '\u0000column', 'row\u0000', 'dead\u0000dead', 'summary:row:1\u0000summary:column:1\u0000extra', cellIdentityKey({ rowId: fixture.sheet.content.rows[4]!, columnId: fixture.sheet.content.columns[5]! })]) source.cells[key] = appearanceVariant();
    let selection = fixture.validate();
    const result = compare(selection, source);
    for (const property of formattingProperties) expect(result[property].effectiveValue).toEqual(APPLICATION_DEFAULT_APPEARANCE[property]);
    Object.defineProperty(source.rows, 'toString', { value: appearanceVariant(), enumerable: true });
    Object.defineProperty(source.columns, '__proto__', { value: appearanceVariant(1), enumerable: true });
    source.cells[cellIdentityKey(fixture.input.extent.cell)] = { fillColor: '#123456' };
    compare(selection, source);
    fixture.sheet.content.rows.reverse(); fixture.sheet.content.columns.reverse();
    selection = fixture.validate();
    compare(selection, source);
  });

  it('preserves serialized number-format order, colour case, alternating and unique dense values', () => {
    const { selection } = formattingFixture(mode, 20, 20);
    const source = emptySheetFormatOverrides();
    for (const [index, key] of coverageKeys(selection).entries()) {
      source.cells[key] = { ...appearanceVariant(index % 2), numberFormat: formattingValues.numberFormat[index % 2 === 0 ? 0 : 2], fillColor: `#${index.toString(16).padStart(6, '0')}` };
    }
    const summary = compare(selection, source);
    expect(summary.numberFormat.effectiveValue).toBeNull(); expect(summary.textColor.effectiveValue).toBeNull(); expect(summary.fillColor.effectiveValue).toBeNull();
  });

  it('agrees on reproducible generated partial-property fixtures (seed 0x5eed)', () => {
    let state = 0x5eed;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    const record = () => Object.fromEntries(formattingProperties.filter(() => random() < 0.45).map((p) => {
      const values = [...formattingValues[p], APPLICATION_DEFAULT_APPEARANCE[p]];
      return [p, values[Math.floor(random() * values.length)]];
    })) as CellAppearance;
    for (let run = 0; run < 32; run += 1) {
      const fixture = formattingFixture(mode, 9, 11, 1 + Math.floor(random() * 9), 1 + Math.floor(random() * 11));
      const source = emptySheetFormatOverrides();
      for (const id of fixture.sheet.content.rows) source.rows[id] = record();
      for (const id of fixture.sheet.content.columns) source.columns[id] = record();
      for (const rowId of fixture.sheet.content.rows) for (const columnId of fixture.sheet.content.columns) {
        if (random() < 0.6) source.cells[cellIdentityKey({ rowId, columnId })] = record();
      }
      if (run % 3 === 0) { fixture.sheet.content.rows.reverse(); fixture.sheet.content.columns.reverse(); }
      compare(fixture.validate(), source);
    }
  });
});
