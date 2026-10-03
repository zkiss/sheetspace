import { afterEach, describe, expect, it, vi } from 'vitest';
import * as identity from '@workbook/core/cellIdentity';
import { emptySheetFormatOverrides } from '@workbook/core/numberFormat';
import { appearanceVariant, formattingFixture } from '@test-support/formattingSummaryFixtures';
import { materializeFormattingWrites } from './formattingWrites';
import { summarizeFormatting, summarizeFormattingDense, summarizeFormattingSparse } from './formattingSummary';
import type { SparseFormattingMetrics } from './formattingSummarySparse';

afterEach(() => vi.restoreAllMocks());

describe.each([{ R: 20, C: 20 }, { R: 100, C: 100 }, { R: 10_000, C: 100 }])('sparse counters on $R x $C axes', ({ R, C }) => {
  for (const mode of ['cells', 'rows', 'columns'] as const) {
    it.each([0, 1, 10].flatMap((count) => [{ count, properties: 5 }, { count, properties: 1 }]))(`${mode}: $count records with $properties properties (blank, late, sparse)`, ({ count, properties }) => {
      const { selection } = formattingFixture(mode, R, C, mode === 'columns' ? 1 : mode === 'rows' ? 2 : R, mode === 'rows' ? 1 : mode === 'columns' ? 2 : C);
      const source = emptySheetFormatOverrides();
      const a = selection.effectiveRowEnd - selection.effectiveRowStart + 1;
      const b = selection.effectiveColumnEnd - selection.effectiveColumnStart + 1;
      for (let n = 0; n < count; n += 1) {
        // Include the very last position, without enumerating E keys in the fixture.
        const offset = selection.effectiveSize - 1 - n;
        const rowId = selection.rows[selection.effectiveRowStart + Math.floor(offset / b)]!;
        const columnId = selection.columns[selection.effectiveColumnStart + offset % b]!;
        source.cells[identity.cellIdentityKey({ rowId, columnId })] = properties === 5 ? appearanceVariant(n) : { fillColor: '#123456' };
      }
      const keys = vi.spyOn(identity, 'cellIdentityKey');
      const decode = vi.spyOn(identity, 'cellIdentityFromKey');
      const entries = vi.spyOn(Object, 'entries'); const objectKeys = vi.spyOn(Object, 'keys');
      let rowReads = 0; let columnReads = 0;
      source.rows = new Proxy(source.rows, { getOwnPropertyDescriptor(target, key) { rowReads += 1; return Reflect.getOwnPropertyDescriptor(target, key); } });
      source.columns = new Proxy(source.columns, { getOwnPropertyDescriptor(target, key) { columnReads += 1; return Reflect.getOwnPropertyDescriptor(target, key); } });
      const metrics = {} as SparseFormattingMetrics;
      summarizeFormattingSparse(selection, source, metrics);
      expect(metrics).toMatchObject({ axisVisits: a + b, cellRecordVisits: count, relevantRecords: count, corrections: properties * count, membershipEntries: a + b });
      expect(rowReads).toBe(a + count); expect(columnReads).toBe(b + count);
      expect(decode).toHaveBeenCalledTimes(count); expect(keys).not.toHaveBeenCalled();
      expect(entries.mock.calls.some(([value]) => value === source.cells)).toBe(false);
      expect(objectKeys.mock.calls.some(([value]) => value === source.cells)).toBe(false);
      expect(metrics.effectiveTotals).toEqual(Array(5).fill(selection.effectiveSize));
      expect(metrics.minimumEffectiveCount).toBeGreaterThan(0);
      expect(metrics.peakHistogramBins).toBeLessThanOrEqual(15 + 10 * count);
      expect(metrics.localBins.every((bins) => bins >= 1 && bins <= count + 1)).toBe(true);
      expect(metrics.effectiveBins.every((bins) => bins >= 1 && bins <= count + 1)).toBe(true);
      if (count === 0) expect(metrics.peakHistogramBins).toBe(15);
      // The default path uses the same cutoff regardless of W (two-axis writes are small).
      keys.mockClear(); decode.mockClear();
      const summary = summarizeFormatting(selection, source);
      expect(keys).toHaveBeenCalledTimes(selection.effectiveSize <= 256 ? selection.effectiveSize : 0);
      expect(decode).toHaveBeenCalledTimes(selection.effectiveSize <= 256 ? 0 : count);
      if (selection.effectiveSize <= 20_000) expect(summary).toEqual(summarizeFormattingDense(selection, source));
    });
  }
});

it.each([0, 10, 1000])('charges the entire own cell map with E fixed at 400 and %i outside records', (outside) => {
  const { sheet, selection } = formattingFixture('cells', 100, 100, 20, 20);
  const source = emptySheetFormatOverrides();
  source.cells[identity.cellIdentityKey({ rowId: sheet.content.rows[19]!, columnId: sheet.content.columns[19]! })] = { fillColor: '#123456' };
  for (let n = 0; n < outside; n += 1) {
    source.cells[identity.cellIdentityKey({ rowId: sheet.content.rows[20 + Math.floor(n / 100)]!, columnId: sheet.content.columns[n % 100]! })] = appearanceVariant();
  }
  source.cells.malformed = appearanceVariant(); source.cells['dead\u0000dead'] = appearanceVariant();
  const decode = vi.spyOn(identity, 'cellIdentityFromKey');
  const metrics = {} as SparseFormattingMetrics;
  const summary = summarizeFormattingSparse(selection, source, metrics);
  expect(metrics).toMatchObject({ axisVisits: 40, membershipEntries: 40, cellRecordVisits: outside + 3, relevantRecords: 1, corrections: 1, peakHistogramBins: 17 });
  expect(decode).toHaveBeenCalledTimes(outside + 3);
  expect(summary).toEqual(summarizeFormattingDense(selection, source));
});

it.each([255, 256, 257])('chooses dense exactly through E=256 (E=%i)', (E) => {
  const { selection } = formattingFixture('cells', 1, E);
  const source = emptySheetFormatOverrides(); source.cells.malformed = { fontWeight: 'bold' };
  const keys = vi.spyOn(identity, 'cellIdentityKey'); const decode = vi.spyOn(identity, 'cellIdentityFromKey');
  const actual = summarizeFormatting(selection, source);
  expect(keys).toHaveBeenCalledTimes(E <= 256 ? E : 0);
  expect(decode).toHaveBeenCalledTimes(E <= 256 ? 0 : 1);
  expect(actual).toEqual(summarizeFormattingDense(selection, source));
});

it.each(['cells', 'rows', 'columns'] as const)('keeps %s writes exactly output-linear, outside the summary', (mode) => {
  const { selection } = formattingFixture(mode, 20, 20);
  const keys = vi.spyOn(identity, 'cellIdentityKey'); const decode = vi.spyOn(identity, 'cellIdentityFromKey');
  const writes = materializeFormattingWrites(selection, 'fillColor', null);
  expect(writes).toHaveLength(selection.writeCount);
  expect(writes.every((write) => Object.keys(write.properties).join() === 'fillColor')).toBe(true);
  expect(keys).toHaveBeenCalledTimes(mode === 'cells' ? selection.writeCount : 0);
  expect(decode).not.toHaveBeenCalled();
});
