export type SheetRenderingMode = 'detailed' | 'overview';

/**
 * A detailed sheet enters overview at or below this effective screen scale.
 * Effective scale is viewport scale multiplied by the sheet's visual scale.
 */
export const SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE = 0.35;

/** An overview returns to the detailed grid at or above this effective screen scale. */
export const SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE = 0.5;

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
    return scale >= SHEET_DETAILED_ENTRY_EFFECTIVE_SCALE ? 'detailed' : 'overview';
  }
  return scale <= SHEET_OVERVIEW_ENTRY_EFFECTIVE_SCALE ? 'overview' : 'detailed';
}
