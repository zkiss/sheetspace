import type { CSSProperties } from 'react';
import { cellKey } from '@workbook/core/address';
import { cellAddressOf, cellIdentityFromKey } from '@workbook/core/cellIdentity';
import type { SheetTabularProjection } from '@workbook/core/model';
import '@workspace/SheetOverview.css';

export const MAX_SHEET_OVERVIEW_SAMPLES = 12;
const MAX_SAMPLE_TEXT_LENGTH = 32;
const OVERVIEW_GEOMETRY = {
  rowHeaderWidth: 23,
  columnHeaderHeight: 19,
  markWidth: 20,
  markHeight: 6,
  markOffsetX: 3,
  markOffsetY: 7,
};
const overviewGridStyle = {
  '--overview-row-header-width': `${OVERVIEW_GEOMETRY.rowHeaderWidth}px`,
  '--overview-column-header-height': `${OVERVIEW_GEOMETRY.columnHeaderHeight}px`,
} as CSSProperties;

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
  sheet,
}: {
  isActive: boolean;
  onSelect: () => void;
  screenScale?: number;
  sheet: SheetTabularProjection;
}) {
  const samples = projectSheetOverview(sheet);
  return (
    <button
      aria-label={`Select sheet ${sheet.name} overview`}
      aria-pressed={isActive}
      className="sheet-overview"
      data-testid="sheet-overview"
      onClick={onSelect}
      type="button"
    >
      <span aria-hidden="true" className="sheet-overview-texture">
        <span className="sheet-overview-grid" style={overviewGridStyle}>
          <span className="sheet-overview-corner" />
          <span className="sheet-overview-column-band" />
          <span className="sheet-overview-row-band" />
          {samples.map((sample) => (
            <span
              className="sheet-overview-data-mark"
              key={sample.address}
              style={samplePosition(sample)}
            />
          ))}
        </span>
      </span>
    </button>
  );
}

function samplePosition(sample: SheetOverviewSample): CSSProperties {
  // Interpolate over the marker's travel, not the entire data area. The far
  // edge reserves its size, translation, and a matching inset so rounded grid
  // corners cannot clip the mark. Single-cell axes stay at the leading inset.
  const { rowHeaderWidth, columnHeaderHeight, markWidth, markHeight, markOffsetX, markOffsetY } = OVERVIEW_GEOMETRY;
  return {
    left: `calc(${rowHeaderWidth}px + ${sample.columnFraction * 100}% - ${sample.columnFraction * (rowHeaderWidth + markWidth + 2 * markOffsetX)}px)`,
    top: `calc(${columnHeaderHeight}px + ${sample.rowFraction * 100}% - ${sample.rowFraction * (columnHeaderHeight + markHeight + 2 * markOffsetY)}px)`,
    width: markWidth,
    height: markHeight,
    transform: `translate(${markOffsetX}px, ${markOffsetY}px)`,
  };
}

function axisFraction(index: number, count: number) {
  return count <= 1 ? 0 : index / (count - 1);
}
