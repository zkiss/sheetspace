import { cellIdentityFromKey } from '@workbook/core/cellIdentity';
import { emptySheetFormatOverrides, resolvePreloadedAppearanceProperty } from '@workbook/core/numberFormat';
import type { CellAppearance, SheetFormatOverrides } from '@workbook/core/model';
import { FormattingHistogram, type HistogramMetrics } from './formattingHistogram';
import type { ValidFormattingSelection } from './formattingSelection';
import { formattingProperties, type FormattingProperty, type FormattingSummary } from './formattingSummaryTypes';

export type SparseFormattingMetrics = HistogramMetrics & {
  axisVisits: number;
  cellRecordVisits: number;
  relevantRecords: number;
  corrections: number;
  membershipEntries: number;
  effectiveTotals: number[];
  effectiveBins: number[];
  localBins: number[];
  minimumEffectiveCount: number;
};

function own(records: Record<string, CellAppearance>, id: string) {
  return Object.prototype.hasOwnProperty.call(records, id) ? records[id] : undefined;
}

/** Exact axis coverage counts followed by cell corrections; never enumerates positions. */
export function summarizeFormattingSparse(
  selection: ValidFormattingSelection,
  overrides: SheetFormatOverrides | undefined,
  metrics?: SparseFormattingMetrics,
): FormattingSummary {
  if (metrics) Object.assign(metrics, { axisVisits: 0, cellRecordVisits: 0, relevantRecords: 0, corrections: 0,
    membershipEntries: 0, histogramBins: 0, peakHistogramBins: 0, effectiveTotals: [], effectiveBins: [], localBins: [], minimumEffectiveCount: Infinity });
  const source = overrides ?? emptySheetFormatOverrides();
  const histograms = () => Object.fromEntries(formattingProperties.map((property) => [property, new FormattingHistogram(metrics)])) as Record<FormattingProperty, FormattingHistogram>;
  const rows = histograms(); const columns = histograms(); const effective = histograms(); const local = histograms();
  const rowIds = new Set<string>(); const columnIds = new Set<string>();
  const a = selection.effectiveRowEnd - selection.effectiveRowStart + 1;
  const b = selection.effectiveColumnEnd - selection.effectiveColumnStart + 1;

  for (let index = selection.effectiveRowStart; index <= selection.effectiveRowEnd; index += 1) {
    const id = selection.rows[index]!; rowIds.add(id);
    const record = own(source.rows, id);
    if (metrics) metrics.axisVisits += 1;
    for (const property of formattingProperties) {
      const value = record?.[property];
      if (value !== undefined) rows[property].add(value);
      if (selection.mode === 'rows') local[property].add(value);
    }
  }
  for (let index = selection.effectiveColumnStart; index <= selection.effectiveColumnEnd; index += 1) {
    const id = selection.columns[index]!; columnIds.add(id);
    const record = own(source.columns, id);
    if (metrics) metrics.axisVisits += 1;
    for (const property of formattingProperties) {
      columns[property].add(resolvePreloadedAppearanceProperty(undefined, undefined, record, property));
      if (selection.mode === 'columns') local[property].add(record?.[property]);
    }
  }
  if (metrics) metrics.membershipEntries = rowIds.size + columnIds.size;
  for (const property of formattingProperties) {
    for (const bin of rows[property].entries()) effective[property].add(bin.value, b * bin.count);
    const absentRows = a - rows[property].total;
    for (const bin of columns[property].entries()) effective[property].add(bin.value, absentRows * bin.count);
  }

  // No Object.keys/entries cell-map container. Even irrelevant own records are decoded.
  for (const key in source.cells) {
    if (!Object.prototype.hasOwnProperty.call(source.cells, key)) continue;
    if (metrics) metrics.cellRecordVisits += 1;
    const identity = cellIdentityFromKey(key);
    if (!identity || !rowIds.has(identity.rowId) || !columnIds.has(identity.columnId)) continue;
    if (metrics) metrics.relevantRecords += 1;
    const cell = source.cells[key]!;
    const row = own(source.rows, identity.rowId); const column = own(source.columns, identity.columnId);
    for (const property of formattingProperties) {
      const value = cell[property];
      if (value === undefined) continue;
      const baseline = resolvePreloadedAppearanceProperty(undefined, row, column, property);
      effective[property].add(baseline, -1);
      effective[property].add(value);
      if (selection.mode === 'cells') local[property].add(value);
      if (metrics) metrics.corrections += 1;
    }
  }
  if (selection.mode === 'cells') {
    for (const property of formattingProperties) local[property].add(undefined, selection.writeCount - local[property].total);
  }

  // Classify only after every correction: complete cell masking can erase mixtures.
  return Object.fromEntries(formattingProperties.map((property) => {
    const localHistogram = local[property];
    const value = localHistogram.commonValue;
    const inherited = localHistogram.size === 1 && value === undefined;
    const state = inherited ? 'inherited' : localHistogram.size === 1 ? 'explicit' : 'mixed';
    if (metrics) {
      let total = 0;
      for (const bin of effective[property].entries()) {
        total += bin.count;
        metrics.minimumEffectiveCount = Math.min(metrics.minimumEffectiveCount, bin.count);
      }
      metrics.effectiveTotals.push(total);
      metrics.effectiveBins.push(effective[property].size);
      metrics.localBins.push(localHistogram.size);
    }
    return [property, { effectiveValue: effective[property].commonValue,
      localValue: state === 'explicit' ? value : null, localOverrideState: state, hasLocalOverrides: !inherited }];
  })) as FormattingSummary;
}
