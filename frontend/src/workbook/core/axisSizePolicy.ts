import type { AxisSizeWrite, SheetPresentation, TabularContent } from './model';

export const DEFAULT_COLUMN_WIDTH = 76;
export const DEFAULT_ROW_HEIGHT = 26.4;
export const AXIS_SIZE_LIMITS = {
  row: { min: 16, max: 1000 },
  column: { min: 24, max: 2000 },
} as const;

export function emptySheetPresentation(): SheetPresentation {
  return { rowHeights: {}, columnWidths: {} };
}

export function isValidAxisSize(axis: AxisSizeWrite['axis'], size: number): boolean {
  const limits = AXIS_SIZE_LIMITS[axis];
  return Number.isFinite(size) && size >= limits.min && size <= limits.max;
}

/** Validate the complete targeted mutation before applying any of its writes. */
export function validAxisSizeWrites(content: TabularContent, writes: readonly AxisSizeWrite[]): boolean {
  if (!Array.isArray(writes) || writes.length === 0) return false;
  const targets = new Set<string>();
  return writes.every((write) => {
    if (!write || (write.axis !== 'row' && write.axis !== 'column') || typeof write.axisId !== 'string') return false;
    const ids = write.axis === 'row' ? content.rows : content.columns;
    const key = JSON.stringify([write.axis, write.axisId]);
    if (!ids.includes(write.axisId) || targets.has(key)) return false;
    targets.add(key);
    return write.size === null || (typeof write.size === 'number' && isValidAxisSize(write.axis, write.size));
  });
}

export function applyAxisSizeWrites(presentation: SheetPresentation, writes: readonly AxisSizeWrite[]): SheetPresentation {
  const next = { rowHeights: { ...presentation.rowHeights }, columnWidths: { ...presentation.columnWidths } };
  for (const write of writes) {
    const overrides = write.axis === 'row' ? next.rowHeights : next.columnWidths;
    if (write.size === null) delete overrides[write.axisId];
    else Object.defineProperty(overrides, write.axisId, { value: write.size, enumerable: true, writable: true, configurable: true });
  }
  return next;
}
