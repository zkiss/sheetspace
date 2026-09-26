import type { CSSProperties } from 'react';
import { cellKey } from '@workbook/core/address';
import { cellAddressOf, cellIdentityFromKey } from '@workbook/core/cellIdentity';
import type { SheetTabularProjection } from '@workbook/core/model';
import '@workspace/SheetOverview.css';

export const MAX_SHEET_OVERVIEW_SAMPLES = 12;
const MAX_SAMPLE_TEXT_LENGTH = 32;

export type SheetOverviewSample = {
  address: string;
  columnFraction: number;
  rowFraction: number;
  text: string;
};

/**
 * Samples at most a fixed number of sparse entries. It never constructs a row ×
 * column projection, so overview work and DOM do not grow with logical area.
 */
export function projectSheetOverview(
  sheet: SheetTabularProjection,
  sampleLimit = MAX_SHEET_OVERVIEW_SAMPLES,
): readonly SheetOverviewSample[] {
  const samples: SheetOverviewSample[] = [];
  const limit = Math.max(0, Math.min(MAX_SHEET_OVERVIEW_SAMPLES, Math.floor(sampleLimit)));
  if (limit === 0) return samples;

  for (const identityKey in sheet.cells) {
    if (!Object.prototype.hasOwnProperty.call(sheet.cells, identityKey)) continue;
    const identity = cellIdentityFromKey(identityKey);
    const address = identity && cellAddressOf(sheet, identity);
    if (!address) continue;
    const raw = sheet.cells[identityKey];
    samples.push({
      address: cellKey(address),
      columnFraction: axisFraction(address.columnIndex, sheet.columns.length),
      rowFraction: axisFraction(address.rowIndex, sheet.rows.length),
      text: raw.length > MAX_SAMPLE_TEXT_LENGTH ? `${raw.slice(0, MAX_SAMPLE_TEXT_LENGTH - 1)}…` : raw,
    });
    if (samples.length === limit) break;
  }
  return samples;
}

export function SheetOverview({
  isActive,
  onSelect,
  screenScale,
  sheet,
}: {
  isActive: boolean;
  onSelect: () => void;
  screenScale: number;
  sheet: SheetTabularProjection;
}) {
  const samples = projectSheetOverview(sheet);
  const overviewScale = normalizedScreenScale(screenScale);
  return (
    <button
      aria-label={`Select sheet ${sheet.name} overview`}
      aria-pressed={isActive}
      className="sheet-overview"
      data-testid="sheet-overview"
      onClick={onSelect}
      type="button"
    >
      <span
        className="sheet-overview-screen"
        data-testid="sheet-overview-screen"
        style={{
          height: `${overviewScale * 100}%`,
          transform: `scale(${1 / overviewScale})`,
          width: `${overviewScale * 100}%`,
        }}
      >
        <span className="sheet-overview-identity">
          <strong title={sheet.name}>{sheet.name}</strong>
          <span>{sheet.rows.length.toLocaleString()} × {sheet.columns.length.toLocaleString()}</span>
        </span>
        <span aria-hidden="true" className="sheet-overview-map">
          {samples.map((sample) => (
            <span
              className="sheet-overview-sample"
              data-overview-sample-address={sample.address}
              key={sample.address}
              style={samplePosition(sample)}
              title={`${sample.address}: ${sample.text}`}
            >
              {sample.text}
            </span>
          ))}
        </span>
        <span className="sheet-overview-count">
          {samples.length === MAX_SHEET_OVERVIEW_SAMPLES ? 'Sampled values' : `${samples.length} populated`}
        </span>
      </span>
    </button>
  );
}

function samplePosition(sample: SheetOverviewSample): CSSProperties {
  return {
    left: `${sample.columnFraction * 100}%`,
    top: `${sample.rowFraction * 100}%`,
    transform: `translate(${-sample.columnFraction * 100}%, ${-sample.rowFraction * 100}%)`,
  };
}

function axisFraction(index: number, count: number) {
  return count <= 1 ? 0 : index / (count - 1);
}

function normalizedScreenScale(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
