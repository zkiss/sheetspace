import { describe, expect, it } from 'vitest';
import { rangeFitsSheetViewport, sheetContentOffsetForCell } from './gridGeometry';
import { positionedSheet } from '@test/workbookFactories';

describe('gridGeometry', () => {
  it('converts a cell address into its sheet-content offset', () => {
    expect(sheetContentOffsetForCell({ columnIndex: 9, rowIndex: 19 }))
      .toEqual({ x: 684, y: 502 });
  });

  it('distinguishes ranges that fit the sheet viewport from internally clipped ranges', () => {
    const sheet = positionedSheet('sheet-data', 'Data', { x: 0, y: 0 });

    expect(rangeFitsSheetViewport({
      start: { columnIndex: 1, rowIndex: 1 },
      end: { columnIndex: 2, rowIndex: 2 },
    }, sheet)).toBe(true);
    expect(rangeFitsSheetViewport({
      start: { columnIndex: 0, rowIndex: 0 },
      end: { columnIndex: 9, rowIndex: 19 },
    }, sheet)).toBe(false);
  });

  it('uses a resized frame viewport when deciding whether a range can be fully shown', () => {
    const sheet = {
      ...positionedSheet('sheet-data', 'Data', { x: 0, y: 0 }),
      frame: {
        ...positionedSheet('sheet-data', 'Data', { x: 0, y: 0 }).frame,
        size: { width: 900, height: 600 },
      },
    };

    expect(rangeFitsSheetViewport({
      start: { columnIndex: 0, rowIndex: 0 },
      end: { columnIndex: 9, rowIndex: 19 },
    }, sheet)).toBe(true);
  });
});
