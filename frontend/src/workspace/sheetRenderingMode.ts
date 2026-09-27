import { SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE } from '@workbook/core/sheetRenderingPolicy';

export type SheetRenderingMode = 'detailed' | 'overview';

/**
 * A detailed sheet enters overview at or below this effective screen scale.
 * Effective scale is viewport scale multiplied by the sheet's visual scale.
 */
export const SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE = 0.35;

/**
 * Boundary comparisons allow a small multiple of Number.EPSILON. This absorbs
 * the rounding introduced by one viewport-scale × visual-scale multiplication
 * without making a perceptible range of nearby scales part of either boundary.
 */
export const SHEET_RENDERING_BOUNDARY_EPSILON_TOLERANCE = 8;

/**
 * Resolve the body presentation from effective scale alone. The gap between the
 * thresholds is a hysteresis band: an already-mounted sheet retains its prior
 * mode there. A newly mounted sheet starts detailed unless it is already at or
 * below the overview-entry threshold.
 */
export function resolveSheetRenderingMode(
  effectiveScale: number,
  previousMode?: SheetRenderingMode,
): SheetRenderingMode {
  const scale = Number.isFinite(effectiveScale) && effectiveScale > 0 ? effectiveScale : 1;
  if (previousMode === 'overview') {
    return isAtOrAboveBoundary(scale, SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE) ? 'detailed' : 'overview';
  }
  return isAtOrBelowBoundary(scale, SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE) ? 'overview' : 'detailed';
}

function isAtOrBelowBoundary(scale: number, boundary: number) {
  return scale <= boundary || isBoundaryEquivalent(scale, boundary);
}

function isAtOrAboveBoundary(scale: number, boundary: number) {
  return scale >= boundary || isBoundaryEquivalent(scale, boundary);
}

function isBoundaryEquivalent(scale: number, boundary: number) {
  const tolerance = Number.EPSILON
    * Math.max(1, Math.abs(scale), Math.abs(boundary))
    * SHEET_RENDERING_BOUNDARY_EPSILON_TOLERANCE;
  return Math.abs(scale - boundary) <= tolerance;
}
